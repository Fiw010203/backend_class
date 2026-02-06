import { Hono } from "hono";

type Env = {
  DB: D1Database;
};

const attendance = new Hono<{ Bindings: Env }>();

/* ======================================================
   👨‍🏫 เช็ครหัสที่ยังใช้งานอยู่
====================================================== */
attendance.get("/active-code/:teacherId", async (c) => {
  try {
    const teacherId = Number(c.req.param("teacherId"));

    const row = await c.env.DB.prepare(
      `
        SELECT id, code, expires_at
        FROM attendance_session
        WHERE teacher_id = ?
        AND expires_at > datetime('now','+7 hours')
        ORDER BY expires_at DESC
        LIMIT 1
      `,
    )
      .bind(teacherId)
      .first();

    if (!row) {
      return c.json({ active: false });
    }

    return c.json({
      active: true,
      sessionId: row.id,
      code: row.code,
      expiresAt: row.expires_at,
    });
  } catch (err) {
    console.error(err);
    return c.json({ message: "Internal Server Error" }, 500);
  }
});

/* ======================================================
   👨‍🏫 Generate Code
====================================================== */
attendance.post("/generate-code", async (c) => {
  try {
    const { teacherId } = await c.req.json();
    const tid = Number(teacherId);

    if (!Number.isFinite(tid)) {
      return c.json({ message: "teacherId ไม่ถูกต้อง" }, 400);
    }

    // 🔍 เช็คว่ามี session ที่ยังไม่หมดอายุไหม
    const active = await c.env.DB.prepare(
      `
        SELECT id, code, expires_at
        FROM attendance_session
        WHERE teacher_id = ?
        AND expires_at > datetime('now','+7 hours')
        ORDER BY expires_at DESC
        LIMIT 1
      `,
    )
      .bind(tid)
      .first();

    if (active) {
      return c.json({
        active: true,
        sessionId: active.id,
        code: active.code,
        expiresAt: active.expires_at,
        message: "ยังมีรหัสที่ใช้งานอยู่",
      });
    }

    // 🎲 สร้างรหัสใหม่
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();

    const result = await c.env.DB.prepare(
      `
        INSERT INTO attendance_session (teacher_id, code, expires_at)
        VALUES (?, ?, datetime('now','+7 hours','+5 minutes'))
      `,
    )
      .bind(tid, code)
      .run();

    return c.json({
      success: true,
      sessionId: result.meta.last_row_id,
      code,
    });
  } catch (err) {
    console.error("generate-code error:", err);
    return c.json({ message: "Internal Server Error" }, 500);
  }
});

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

    // 🔎 หา session + teacher_id
    const session = await c.env.DB
      .prepare(`
        SELECT id, teacher_id
        FROM attendance_session
        WHERE code = ?
        AND expires_at > datetime('now','+7 hours')
      `)
      .bind(code)
      .first()

    if (!session) {
      return c.json({ message: "รหัสไม่ถูกต้องหรือหมดอายุ" }, 400)
    }

    // ⭐ เช็คว่านิสิตอยู่ในตารางอาจารย์คนนี้ไหม
    const student = await c.env.DB
      .prepare(`
        SELECT id
        FROM students
        WHERE id = ?
        AND teacher_id = ?
      `)
      .bind(sid, session.teacher_id)
      .first()

    if (!student) {
      return c.json(
        { message: "❌ คุณไม่ได้อยู่ในรายชื่อนิสิตของอาจารย์รายนี้" },
        403
      )
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

    const rows = await c.env.DB.prepare(`
      SELECT
        s.fullname,
        s.student_code,
        a.checked_at,
        CASE
          WHEN a.attendance_id IS NULL THEN 'ขาด'
          WHEN a.status = 'leave' THEN 'ลา'
          ELSE 'มา'
        END AS status
      FROM students s
      LEFT JOIN (
        SELECT
          a.id AS attendance_id,
          a.student_id,
          a.status,
          MAX(a.checked_at) AS checked_at
        FROM attendance a
        JOIN attendance_session se ON a.session_id = se.id
        WHERE se.teacher_id = ?
          AND date(a.checked_at) = ?
        GROUP BY a.student_id
      ) a ON a.student_id = s.id
      WHERE s.teacher_id = ?
      ORDER BY s.student_code
    `)
      .bind(teacherId, date, teacherId)
      .all()

    let csv = "ชื่อ-นามสกุล,รหัสนักศึกษา,สถานะ,เวลาเช็คชื่อ\n"

    rows.results.forEach((r: any) => {
      csv += `"${r.fullname}","${r.student_code}","${r.status}","${r.checked_at || ""}"\n`
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

/* ======================================================
   📤 Import รายชื่อนิสิต (CSV) - teacher only
====================================================== */
attendance.post("/students/import", async (c) => {
  try {
    const teacherId = Number(c.req.query("teacherId"))
    if (!teacherId) {
      return c.json({ message: "ไม่พบ teacherId" }, 400)
    }

    const form = await c.req.formData()
    const file = form.get("file")
    if (!file || typeof file === "string") {
      return c.json({ message: "ไม่พบไฟล์ CSV" }, 400)
    }

    const text = await file.text()
    const lines = text.split(/\r?\n/).slice(1)

    let processed = 0

    for (const line of lines) {
      if (!line.trim()) continue

      const [student_code, fullname] = line.split(",")
      if (!student_code || !fullname) continue

      // 1️⃣ upsert students (แก้ conflict ให้ถูก)
      const result = await c.env.DB.prepare(`
        INSERT INTO students (student_code, fullname, teacher_id)
        VALUES (?, ?, ?)
        ON CONFLICT(student_code, teacher_id)
        DO UPDATE SET fullname = excluded.fullname
        RETURNING id
      `)
        .bind(
          student_code.trim(),
          fullname.trim(),
          teacherId
        )
        .first()

      const studentId = result?.id
      if (!studentId) continue

      // 2️⃣ สร้าง attendance = absent ถ้ายังไม่มี (สำคัญมาก)
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO attendance (student_id, session_id, status)
        SELECT ?, se.id, 'absent'
        FROM attendance_session se
        WHERE se.teacher_id = ?
      `)
        .bind(studentId, teacherId)
        .run()

      processed++
    }

    return c.json({
      success: true,
      message: `นำเข้า/อัปเดต ${processed} คน สำเร็จ`
    })
  } catch (err) {
    console.error("IMPORT ERROR:", err)
    return c.json({ message: "Import failed" }, 500)
  }
})



/* ======================================================
   📋 ตารางรายชื่อ (มา / ลา / ขาด)
====================================================== */
attendance.get("/list/:teacherId", async (c) => {
  try {
    const teacherId = Number(c.req.param("teacherId"));
    const dateParam = c.req.query("date");
    let date = (Array.isArray(dateParam) ? dateParam[0] : dateParam)?.trim();

    if (!date) {
      const row = await c.env.DB.prepare(
        `SELECT date('now','+7 hours') AS today`
      ).first();
      date = row?.today;
    }

    const rows = await c.env.DB.prepare(
      `
      SELECT
        s.fullname,
        s.student_code,
        a.attendance_id,
        a.checked_at,
        CASE
          WHEN a.attendance_id IS NULL THEN 'absent'
          ELSE a.status
        END AS status
      FROM students s
      LEFT JOIN (
        SELECT
          a.id AS attendance_id,
          a.student_id,
          a.status,
          MAX(a.checked_at) AS checked_at
        FROM attendance a
        JOIN attendance_session se
          ON a.session_id = se.id
        WHERE se.teacher_id = ?
          AND date(a.checked_at) = ?
        GROUP BY a.student_id
      ) a ON a.student_id = s.id
      WHERE s.teacher_id = ?
      ORDER BY s.student_code
      `
    )
      .bind(teacherId, date, teacherId)
      .all();

    return c.json({ students: rows.results });
  } catch (err) {
    console.error(err);
    return c.json({ message: "โหลดข้อมูลไม่สำเร็จ" }, 500);
  }
});
/* ======================================================
   ✏️ แก้ไขสถานะการเข้าเรียน
====================================================== */
attendance.put("/:attendanceId", async (c) => {
  try {
    const attendanceId = Number(c.req.param("attendanceId"));
    const { status } = await c.req.json();

    if (!["present", "leave"].includes(status)) {
      return c.json({ message: "status ไม่ถูกต้อง" }, 400);
    }

    await c.env.DB.prepare(
      `UPDATE attendance
       SET status = ?
       WHERE id = ?`
    )
      .bind(status, attendanceId)
      .run();

    return c.json({ message: "อัปเดตสถานะเรียบร้อย" });
  } catch (err) {
    console.error(err);
    return c.json({ message: "แก้ไขไม่สำเร็จ" }, 500);
  }
});


export default attendance;
