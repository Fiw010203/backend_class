import { Hono } from "hono"

type Env = {
  DB: D1Database
}

const attendance = new Hono<{ Bindings: Env }>()

/* ======================================================
   👨‍🏫 สร้างรหัสเช็คชื่อ (Teacher)
====================================================== */
attendance.post("/generate-code", async (c) => {
  try {
    const body = await c.req.json()
    const teacherId = Number(body?.teacherId)

    if (!Number.isFinite(teacherId)) {
      return c.json({ message: "teacherId ไม่ถูกต้อง" }, 400)
    }

    // ตรวจสอบว่าเป็นอาจารย์จริง
    const teacher = await c.env.DB
      .prepare("SELECT id, role FROM users WHERE id = ?")
      .bind(teacherId)
      .first()

    if (!teacher || teacher.role !== "teacher") {
      return c.json({ message: "ไม่พบอาจารย์ที่ระบุ" }, 400)
    }

    // สร้าง code (ไม่ซ้ำ และยังไม่หมดอายุ)
    let code: string | undefined

    for (let i = 0; i < 6; i++) {
      const candidate = Math.random()
        .toString(36)
        .substring(2, 7)
        .toUpperCase()

      const exists = await c.env.DB
        .prepare(`
          SELECT 1 FROM attendance_code
          WHERE code = ?
          AND expires_at > datetime('now','+7 hours')
        `)
        .bind(candidate)
        .first()

      if (!exists) {
        code = candidate
        break
      }
    }

    if (!code) {
      return c.json({ message: "ไม่สามารถสร้างรหัสได้ โปรดลองใหม่" }, 500)
    }

    // บันทึกรหัส (อายุ 5 นาที)
    await c.env.DB
      .prepare(`
        INSERT INTO attendance_code (code, teacher_id, expires_at)
        VALUES (?, ?, datetime('now','+7 hours','+5 minutes'))
      `)
      .bind(code, teacherId)
      .run()

    return c.json({ success: true, code })
  } catch (err) {
    console.error("❌ GENERATE CODE ERROR:", err)
    return c.json({ success: false, message: "ไม่สามารถสร้างรหัสได้" }, 500)
  }
})

/* ======================================================
   👨‍🎓 นักเรียนเช็คชื่อ
====================================================== */
attendance.post("/checkin", async (c) => {
  try {
    const { studentId, code } = await c.req.json()
    const sid = Number(studentId)

    if (!Number.isFinite(sid) || !code) {
      return c.json({ message: "ข้อมูลไม่ถูกต้อง" }, 400)
    }

    // ตรวจสอบนักเรียน
    const student = await c.env.DB
      .prepare("SELECT id, role FROM users WHERE id = ?")
      .bind(sid)
      .first()

    if (!student || student.role !== "student") {
      return c.json({ message: "ไม่พบนักเรียนที่ระบุ" }, 400)
    }

    // ตรวจสอบรหัสยังไม่หมดอายุ
    const validCode = await c.env.DB
      .prepare(`
        SELECT * FROM attendance_code
        WHERE code = ?
        AND expires_at > datetime('now','+7 hours')
      `)
      .bind(code)
      .first()

    if (!validCode) {
      return c.json({ message: "รหัสไม่ถูกต้องหรือหมดอายุ" }, 400)
    }

    // ตรวจสอบเช็คชื่อซ้ำ
    const already = await c.env.DB
      .prepare(`
        SELECT 1 FROM attendance
        WHERE student_id = ? AND code = ?
      `)
      .bind(sid, code)
      .first()

    if (already) {
      return c.json({ message: "คุณเช็คชื่อไปแล้ว" }, 400)
    }

    // บันทึกเช็คชื่อ
    await c.env.DB
      .prepare(`
        INSERT INTO attendance (student_id, code)
        VALUES (?, ?)
      `)
      .bind(sid, code)
      .run()

    return c.json({ success: true, message: "เช็คชื่อสำเร็จ ✅" })
  } catch (err) {
    console.error("❌ CHECKIN ERROR:", err)
    return c.json({ message: "เกิดข้อผิดพลาดในการเช็คชื่อ" }, 500)
  }
})

/* ======================================================
   📋 รายการเช็คชื่อ (เลือกวันได้)
====================================================== */
attendance.get("/list", async (c) => {
  try {
    const dateParam = c.req.query("date")
    let date = (Array.isArray(dateParam) ? dateParam[0] : dateParam)?.trim()

    // ดึงทั้งหมด
    if (date && date.toLowerCase() === "all") {
      const rows = await c.env.DB
        .prepare(`
          SELECT 
            a.id AS attendance_id,
            s.fullname,
            s.student_code,
            a.checked_at
          FROM attendance a
          JOIN students s ON a.student_id = s.user_id
          ORDER BY a.checked_at DESC
        `)
        .all()

      return c.json({ students: rows.results })
    }

    // ค่าเริ่มต้น = วันนี้ (เวลาไทย)
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
        JOIN students s ON a.student_id = s.user_id
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
  try {
    const id = Number(c.req.param("id"))
    if (!Number.isFinite(id)) {
      return c.json({ message: "id ไม่ถูกต้อง" }, 400)
    }

    const result = await c.env.DB
      .prepare("DELETE FROM attendance WHERE id = ?")
      .bind(id)
      .run()

    if (result.meta.changes === 0) {
      return c.json({ message: "ไม่พบรายการที่ต้องการลบ" }, 404)
    }

    return c.json({ message: "ลบรายการสำเร็จ" })
  } catch (err) {
    console.error(err)
    return c.json({ message: "ลบรายการไม่สำเร็จ" }, 500)
  }
})

/* ======================================================
   📥 Export CSV
====================================================== */
attendance.get("/export", async (c) => {
  try {
    const dateParam = c.req.query("date")
    let date = (Array.isArray(dateParam) ? dateParam[0] : dateParam)?.trim()

    let rows

    if (date && date.toLowerCase() === "all") {
      rows = await c.env.DB
        .prepare(`
          SELECT 
            s.fullname,
            s.student_code,
            a.checked_at
          FROM attendance a
          JOIN students s ON a.student_id = s.user_id
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
          SELECT 
            s.fullname,
            s.student_code,
            a.checked_at
          FROM attendance a
          JOIN students s ON a.student_id = s.user_id
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
