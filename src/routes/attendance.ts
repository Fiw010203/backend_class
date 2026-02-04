import { Hono } from "hono"

type Env = {
  DB: D1Database
}

const attendance = new Hono<{ Bindings: Env }>()

/* ======================================================
   👨‍🏫 เช็ครหัสที่ยังใช้งานอยู่
====================================================== */
attendance.get("/active-code/:teacherId", async (c) => {
  try {
    const teacherId = Number(c.req.param("teacherId"))

    const row = await c.env.DB
      .prepare(`
        SELECT id, code, expires_at
        FROM attendance_session
        WHERE teacher_id = ?
        AND expires_at > datetime('now','+7 hours')
        ORDER BY expires_at DESC
        LIMIT 1
      `)
      .bind(teacherId)
      .first()

    if (!row) {
      return c.json({ active: false })
    }

    return c.json({
      active: true,
      sessionId: row.id,
      code: row.code,
      expiresAt: row.expires_at
    })
  } catch (err) {
    console.error(err)
    return c.json({ message: "Internal Server Error" }, 500)
  }
})

/* ======================================================
   👨‍🏫 Generate Code
====================================================== */
attendance.post("/generate-code", async (c) => {
  try {
    const { teacherId } = await c.req.json()
    const tid = Number(teacherId)

    if (!Number.isFinite(tid)) {
      return c.json({ message: "teacherId ไม่ถูกต้อง" }, 400)
    }

    // 🔍 เช็คว่ามี session ที่ยังไม่หมดอายุไหม
    const active = await c.env.DB
      .prepare(`
        SELECT id, code, expires_at
        FROM attendance_session
        WHERE teacher_id = ?
        AND expires_at > datetime('now','+7 hours')
        ORDER BY expires_at DESC
        LIMIT 1
      `)
      .bind(tid)
      .first()

    if (active) {
      return c.json({
        active: true,
        sessionId: active.id,
        code: active.code,
        expiresAt: active.expires_at,
        message: "ยังมีรหัสที่ใช้งานอยู่"
      })
    }

    // 🎲 สร้างรหัสใหม่
    const code = Math.random()
      .toString(36)
      .substring(2, 7)
      .toUpperCase()

    const result = await c.env.DB
      .prepare(`
        INSERT INTO attendance_session (teacher_id, code, expires_at)
        VALUES (?, ?, datetime('now','+7 hours','+5 minutes'))
      `)
      .bind(tid, code)
      .run()

    return c.json({
      success: true,
      sessionId: result.meta.last_row_id,
      code
    })
  } catch (err) {
    console.error("generate-code error:", err)
    return c.json({ message: "Internal Server Error" }, 500)
  }
})

/* ======================================================
   👨‍🎓 นักศึกษาเช็คชื่อ
====================================================== */
attendance.post("/checkin", async (c) => {
  try {
    const { studentId, code } = await c.req.json()
    const sid = Number(studentId)

    if (!Number.isFinite(sid) || !code) {
      return c.json({ message: "ข้อมูลไม่ถูกต้อง" }, 400)
    }

    // 🔎 หา session จาก code
    const session = await c.env.DB
      .prepare(`
        SELECT id
        FROM attendance_session
        WHERE code = ?
        AND expires_at > datetime('now','+7 hours')
      `)
      .bind(code)
      .first()

    if (!session) {
      return c.json({ message: "รหัสไม่ถูกต้องหรือหมดอายุ" }, 400)
    }

    // ❌ เช็คว่าซ้ำไหม
    const already = await c.env.DB
      .prepare(`
        SELECT 1
        FROM attendance
        WHERE session_id = ? AND student_id = ?
      `)
      .bind(session.id, sid)
      .first()

    if (already) {
      return c.json({ message: "คุณเช็คชื่อไปแล้ว" }, 400)
    }

    // ✅ บันทึกการเช็คชื่อ
    await c.env.DB
      .prepare(`
        INSERT INTO attendance (session_id, student_id)
        VALUES (?, ?)
      `)
      .bind(session.id, sid)
      .run()

    return c.json({ success: true, message: "เช็คชื่อสำเร็จ ✅" })
  } catch (err) {
    console.error(err)
    return c.json({ message: "Internal Server Error" }, 500)
  }
})

/* ======================================================
   📋 ตารางรายชื่อ (แยกตามอาจารย์)
====================================================== */
attendance.get("/list/:teacherId", async (c) => {
  try {
    const teacherId = Number(c.req.param("teacherId"))
    const dateParam = c.req.query("date")
    let date = (Array.isArray(dateParam) ? dateParam[0] : dateParam)?.trim()

    if (!date) {
      const row = await c.env.DB
        .prepare(`SELECT date('now','+7 hours') AS today`)
        .first()
      date = row?.today
    }

    const rows = await c.env.DB
      .prepare(`
        SELECT
          a.id AS attendance_id,
          s.fullname,
          s.student_code,
          a.checked_at
        FROM attendance a
        JOIN attendance_session se ON a.session_id = se.id
        JOIN students s ON a.student_id = s.id
        WHERE se.teacher_id = ?
        AND date(a.checked_at) = ?
        ORDER BY a.checked_at DESC
      `)
      .bind(teacherId, date)
      .all()

    return c.json({ students: rows.results })
  } catch (err) {
    console.error(err)
    return c.json({ message: "โหลดข้อมูลไม่สำเร็จ" }, 500)
  }
})

/* ======================================================
   📥 Export CSV
====================================================== */
attendance.get("/export/:teacherId", async (c) => {
  try {
    const teacherId = Number(c.req.param("teacherId"))
    const dateParam = c.req.query("date")
    let date = (Array.isArray(dateParam) ? dateParam[0] : dateParam)?.trim()

    if (!date) {
      const row = await c.env.DB
        .prepare(`SELECT date('now','+7 hours') AS today`)
        .first()
      date = row?.today
    }

    const rows = await c.env.DB
      .prepare(`
        SELECT
          s.fullname,
          s.student_code,
          a.checked_at
        FROM attendance a
        JOIN attendance_session se ON a.session_id = se.id
        JOIN students s ON a.student_id = s.id
        WHERE se.teacher_id = ?
        AND date(a.checked_at) = ?
        ORDER BY a.checked_at DESC
      `)
      .bind(teacherId, date)
      .all()

    let csv = "ชื่อ-นามสกุล,รหัสนักศึกษา,เวลาเช็คชื่อ\n"
    rows.results.forEach((r: any) => {
      csv += `"${r.fullname}","${r.student_code}","${r.checked_at}"\n`
    })

    return c.body(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=attendance-${date}.csv`
      }
    })
  } catch (err) {
    console.error(err)
    return c.text("Export failed", 500)
  }
})

export default attendance
