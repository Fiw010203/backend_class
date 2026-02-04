import { Hono } from "hono"

const attendance = new Hono()

const getDb = (c: any) => {
  const db = c.env?.my_db
  if (!db) throw new Error("Database not available")
  return db
}


// 👨‍🏫 สร้างรหัสเช็คชื่อ
attendance.post("/generate-code", async (c) => {
  try {
    // expect teacherId from request (or replace with session user id)
    const body = await c.req.json()
    const db = getDb(c)
    const teacherId = Number(body?.teacherId)
    if (!Number.isFinite(teacherId)) {
      return c.json({ message: "teacherId ไม่ถูกต้อง" }, 400)
    }

    // validate teacher exists and is a teacher
    const teacher = db.prepare("SELECT id, role FROM users WHERE id = ?").get(teacherId)
    if (!teacher || teacher.role !== "teacher") {
      return c.json({ message: "ไม่พบอาจารย์ที่ระบุ" }, 400)
    }

    // generate a unique 5-character alphanumeric uppercase code (retry a few times)
    let code: string | undefined
    for (let i = 0; i < 6; i++) {
      code = Math.random().toString(36).substring(2, 7).toUpperCase()
      const exists = db.prepare(`
        SELECT 1 FROM attendance_code
        WHERE code = ? AND expires_at > datetime('now','+7 hours')
      `).get(code)
      if (!exists) break
    }

    if (!code) {
      return c.json({ message: "ไม่สามารถสร้างรหัสได้ โปรดลองใหม่" }, 500)
    }

    // if still colliding with an active code, fail
    const collided = db.prepare(`
      SELECT 1 FROM attendance_code
      WHERE code = ? AND expires_at > datetime('now','+7 hours')
    `).get(code)
    if (collided) {
      return c.json({ message: "ไม่สามารถสร้างรหัสได้ โปรดลองใหม่" }, 500)
    }

    // store expires_at using DB timezone (+7 hours)
    db.prepare(`
      INSERT INTO attendance_code (code, teacher_id, expires_at)
      VALUES (?, ?, datetime('now','+7 hours','+5 minutes'))
    `).run(code, teacherId)

    return c.json({ code })
  } catch (err) {
    console.error("DB error:", err)
    return c.json({ error: "ไม่สามารถสร้างรหัสได้" }, 500)
  }
})

// 👨‍🎓 นักเรียนเช็คชื่อ
attendance.post("/checkin", async (c) => {
  try {
    const { studentId, code } = await c.req.json()
    const db = getDb(c)

    if (!Number.isFinite(Number(studentId))) {
      return c.json({ message: "studentId ไม่ถูกต้อง" }, 400)
    }

    // validate student exists and is a student
    const student = db.prepare("SELECT id, role FROM users WHERE id = ?").get(Number(studentId))
    if (!student || student.role !== "student") {
      return c.json({ message: "ไม่พบนักเรียนที่ระบุ" }, 400)
    }

    // ตรวจสอบรหัสยังไม่หมดอายุ (ใช้งาน timezone ของ DB +7 ชั่วโมง)
    const validCode = db.prepare(`
      SELECT * FROM attendance_code
      WHERE code = ? AND expires_at > datetime('now','+7 hours')
    `).get(code)

    if (!validCode) {
      return c.json({ message: "รหัสไม่ถูกต้องหรือหมดอายุ" }, 400)
    }

    // ตรวจสอบนักเรียนเช็คชื่อซ้ำ
    const already = db.prepare(`
      SELECT * FROM attendance
      WHERE student_id = ? AND code = ?
    `).get(Number(studentId), code)

    if (already) {
      return c.json({ message: "คุณเช็คชื่อไปแล้ว" }, 400)
    }

    // บันทึกเช็คชื่อ
    db.prepare(`
      INSERT INTO attendance (student_id, code)
      VALUES (?, ?)
    `).run(Number(studentId), code)

    return c.json({ message: "เช็คชื่อสำเร็จ ✅" })
  } catch (err) {
    console.error("DB error:", err)
    return c.json({ error: "เกิดข้อผิดพลาดในการเช็คชื่อ" }, 500)
  }
})
// 📋 ตารางรายชื่อนักเรียน (fullname + student_code)
attendance.get("/list", (c) => {
  try {
    const dateParam = c.req.query("date")
    const db = getDb(c)
    let date = (Array.isArray(dateParam) ? dateParam[0] : dateParam)?.trim()
    console.log("[attendance/list] date param:", date)

    // Support ?date=all to fetch everything
    if (date && date.toLowerCase() === "all") {
      const rows = db.prepare(`
        SELECT 
          a.id AS attendance_id,
          s.fullname,
          s.student_code,
          a.checked_at
        FROM attendance a
        JOIN students s ON a.student_id = s.user_id
        ORDER BY a.checked_at DESC
      `).all()
      return c.json({ students: rows })
    }

    // Default to today's date (DB timezone +7) when no date provided
    if (!date) {
      const row = db.prepare("SELECT date('now','+7 hours') AS today").get()
      date = row.today
      console.log("[attendance/list] defaulted date to:", date)
    }

    const rows = db.prepare(`
      SELECT 
        a.id AS attendance_id,
        s.fullname,
        s.student_code,
        a.checked_at
      FROM attendance a
      JOIN students s ON a.student_id = s.user_id
      WHERE date(a.checked_at) = ?
      ORDER BY a.checked_at DESC
    `).all([date])

    return c.json({ students: rows })
  } catch (err) {
    console.error(err)
    return c.json({ message: "โหลดข้อมูลไม่สำเร็จ" }, 500)
  }
})

// 🗑️ ลบรายการเช็คชื่อที่ผิดพลาด
attendance.delete("/:id", (c) => {
  try {
    const id = Number(c.req.param("id"))
    const db = getDb(c)
    if (!Number.isFinite(id)) {
      return c.json({ message: "id ไม่ถูกต้อง" }, 400)
    }

    const result = db.prepare(`
      DELETE FROM attendance
      WHERE id = ?
    `).run(id)

    if (result.changes === 0) {
      return c.json({ message: "ไม่พบรายการที่ต้องการลบ" }, 404)
    }

    return c.json({ message: "ลบรายการสำเร็จ" })
  } catch (err) {
    console.error(err)
    return c.json({ message: "ลบรายการไม่สำเร็จ" }, 500)
  }
})
// 📥 ดาวน์โหลดตารางเช็คชื่อ (CSV)
attendance.get("/export", (c) => {
  try {
    const dateParam = c.req.query("date")
    const db = getDb(c)
    let date = (Array.isArray(dateParam) ? dateParam[0] : dateParam)?.trim()

    // support ?date=all to export everything
    if (date && date.toLowerCase() === "all") {
      const rows = db.prepare(`
        SELECT 
          s.fullname,
          s.student_code,
          a.checked_at
        FROM attendance a
        JOIN students s ON a.student_id = s.user_id
        ORDER BY a.checked_at DESC
      `).all()

      let csv = "ชื่อ-นามสกุล,รหัสนักศึกษา,เวลาเช็คชื่อ\n"
      rows.forEach((r: any) => {
        csv += `"${r.fullname}","${r.student_code}","${r.checked_at}"\n`
      })

      return c.body(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=attendance.csv",
        },
      })
    }

    // default to today's date when not provided
    if (!date) {
      const row = db.prepare("SELECT date('now','+7 hours') AS today").get()
      date = row.today
    }

    const rows = db.prepare(`
      SELECT 
        s.fullname,
        s.student_code,
        a.checked_at
      FROM attendance a
      JOIN students s ON a.student_id = s.user_id
      WHERE date(a.checked_at) = ?
      ORDER BY a.checked_at DESC
    `).all([date])

    let csv = "ชื่อ-นามสกุล,รหัสนักศึกษา,เวลาเช็คชื่อ\n"

    rows.forEach((r: any) => {
      csv += `"${r.fullname}","${r.student_code}","${r.checked_at}"\n`
    })

    return c.body(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=attendance-${date}.csv`,
      },
    })
  } catch (err) {
    console.error(err)
    return c.text("Export failed", 500)
  }
})


export default attendance
