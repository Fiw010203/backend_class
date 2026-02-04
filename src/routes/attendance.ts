import { Hono } from "hono"

type Env = {
  DB: D1Database
}

const attendance = new Hono<{ Bindings: Env }>()

/* ======================================================
   👨‍🏫 เช็ครหัสที่ยังใช้งานอยู่
====================================================== */
attendance.get("/active-code/:teacherId", async (c) => {
  const teacherId = Number(c.req.param("teacherId"))

  const row = await c.env.DB
    .prepare(`
      SELECT code, expires_at
      FROM attendance_code
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
    code: row.code,
    expiresAt: row.expires_at
  })
})

/* ======================================================
   👨‍🏫 Generate Code (อาจารย์)
====================================================== */
attendance.post("/generate-code", async (c) => {
  const { teacherId } = await c.req.json()
  const tid = Number(teacherId)

  if (!Number.isFinite(tid)) {
    return c.json({ message: "teacherId ไม่ถูกต้อง" }, 400)
  }

  // 🔒 block ถ้ายังมี code ใช้งานอยู่
  const active = await c.env.DB
    .prepare(`
      SELECT code, expires_at
      FROM attendance_code
      WHERE teacher_id = ?
      AND expires_at > datetime('now','+7 hours')
      LIMIT 1
    `)
    .bind(tid)
    .first()

  if (active) {
    return c.json(
      {
        active: true,
        code: active.code,
        expiresAt: active.expires_at,
        message: "ยังมีรหัสที่ใช้งานอยู่"
      },
      409
    )
  }

  const code = Math.random()
    .toString(36)
    .substring(2, 7)
    .toUpperCase()

  await c.env.DB
    .prepare(`
      INSERT INTO attendance_code (code, teacher_id, expires_at)
      VALUES (?, ?, datetime('now','+7 hours','+5 minutes'))
    `)
    .bind(code, tid)
    .run()

  return c.json({ success: true, code })
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

    // 🔍 ตรวจว่านักศึกษามีจริง
    const student = await c.env.DB
      .prepare(`
        SELECT id
        FROM students
        WHERE id = ?
      `)
      .bind(sid)
      .first()

    if (!student) {
      return c.json({ message: "ไม่พบนักศึกษา" }, 400)
    }

    // 🔑 ตรวจ code
    const validCode = await c.env.DB
      .prepare(`
        SELECT id
        FROM attendance_code
        WHERE code = ?
        AND expires_at > datetime('now','+7 hours')
      `)
      .bind(code)
      .first()

    if (!validCode) {
      return c.json({ message: "รหัสไม่ถูกต้องหรือหมดอายุ" }, 400)
    }

    // 🚫 กันเช็คชื่อซ้ำ
    const already = await c.env.DB
      .prepare(`
        SELECT 1
        FROM attendance
        WHERE student_id = ? AND code = ?
      `)
      .bind(sid, code)
      .first()

    if (already) {
      return c.json({ message: "คุณเช็คชื่อไปแล้ว" }, 400)
    }

    // ✅ บันทึก
    await c.env.DB
      .prepare(`
        INSERT INTO attendance (student_id, code)
        VALUES (?, ?)
      `)
      .bind(sid, code)
      .run()

    return c.json({ success: true, message: "เช็คชื่อสำเร็จ ✅" })
  } catch (err) {
    console.error("CHECKIN ERROR:", err)
    return c.json({ message: "เกิดข้อผิดพลาด" }, 500)
  }
})

/* ======================================================
   📋 ตารางรายชื่อ
====================================================== */
attendance.get("/list", async (c) => {
  try {
    const dateParam = c.req.query("date")
    let date = (Array.isArray(dateParam) ? dateParam[0] : dateParam)?.trim()

    if (date === "all") {
      const rows = await c.env.DB
        .prepare(`
          SELECT
            a.id AS attendance_id,
            s.fullname,
            s.student_code,
            a.checked_at
          FROM attendance a
          JOIN students s ON a.student_id = s.id
          ORDER BY a.checked_at DESC
        `)
        .all()

      return c.json({ students: rows.results })
    }

    if (!date) {
      const row = await c.env.DB
        .prepare("SELECT date('now','+7 hours') AS today")
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
        JOIN students s ON a.student_id = s.id
        WHERE date(a.checked_at) = ?
        ORDER BY a.checked_at DESC
      `)
      .bind(date)
      .all()

    return c.json({ students: rows.results })
  } catch (err) {
    console.error(err)
    return c.json({ message: "โหลดข้อมูลไม่สำเร็จ" }, 500)
  }
})

/* ======================================================
   🗑️ ลบรายการเช็คชื่อ
====================================================== */
attendance.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"))

  if (!Number.isFinite(id)) {
    return c.json({ message: "id ไม่ถูกต้อง" }, 400)
  }

  const result = await c.env.DB
    .prepare(`DELETE FROM attendance WHERE id = ?`)
    .bind(id)
    .run()

  if (result.meta.changes === 0) {
    return c.json({ message: "ไม่พบข้อมูล" }, 404)
  }

  return c.json({ message: "ลบสำเร็จ" })
})

/* ======================================================
   📥 Export CSV
====================================================== */
attendance.get("/export", async (c) => {
  try {
    const dateParam = c.req.query("date")
    let date = (Array.isArray(dateParam) ? dateParam[0] : dateParam)?.trim()

    let rows

    if (date === "all") {
      rows = await c.env.DB
        .prepare(`
          SELECT s.fullname, s.student_code, a.checked_at
          FROM attendance a
          JOIN students s ON a.student_id = s.id
          ORDER BY a.checked_at DESC
        `)
        .all()
    } else {
      if (!date) {
        const row = await c.env.DB
          .prepare("SELECT date('now','+7 hours') AS today")
          .first()
        date = row?.today
      }

      rows = await c.env.DB
        .prepare(`
          SELECT s.fullname, s.student_code, a.checked_at
          FROM attendance a
          JOIN students s ON a.student_id = s.id
          WHERE date(a.checked_at) = ?
          ORDER BY a.checked_at DESC
        `)
        .bind(date)
        .all()
    }

    let csv = "ชื่อ-นามสกุล,รหัสนักศึกษา,เวลาเช็คชื่อ\n"
    rows.results.forEach((r: any) => {
      csv += `"${r.fullname}","${r.student_code}","${r.checked_at}"\n`
    })

    return c.body(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=attendance-${date ?? "all"}.csv`,
      },
    })
  } catch (err) {
    console.error(err)
    return c.text("Export failed", 500)
  }
})

export default attendance
