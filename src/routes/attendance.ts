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
    const { studentId, code } = await c.req.json();
    const sid = Number(studentId);

    // 1️⃣ validate input
    if (!Number.isFinite(sid) || !code) {
      return c.json({ message: "ข้อมูลไม่ถูกต้อง" }, 400);
    }

    // 2️⃣ หา session ที่ยังไม่หมดอายุ
    const session = await c.env.DB.prepare(
      `
        SELECT id, teacher_id
        FROM attendance_session
        WHERE code = ?
        AND expires_at > datetime('now','+7 hours')
      `,
    )
      .bind(code)
      .first();

    if (!session) {
      return c.json({ message: "รหัสไม่ถูกต้องหรือหมดอายุ" }, 400);
    }

    // 3️⃣ เช็คว่านิสิต (students.id) อยู่ในคลาสอาจารย์คนนี้จริงไหม
    const student = await c.env.DB.prepare(
      `
        SELECT id
        FROM students
        WHERE id = ?
        AND teacher_id = ?
      `,
    )
      .bind(sid, session.teacher_id)
      .first();

    if (!student) {
      return c.json(
        { message: "❌ คุณไม่ได้อยู่ในรายชื่อนิสิตของอาจารย์รายนี้" },
        403,
      );
    }

    // 4️⃣ เช็คว่าซ้ำหรือยัง (เฉพาะ present/leave เท่านั้น)
    const already = await c.env.DB.prepare(
      `
    SELECT 1
    FROM attendance
    WHERE session_id = ?
    AND student_id = ?
    AND status != 'absent'
  `,
    )
      .bind(session.id, sid)
      .first();

    if (already) {
      return c.json({ message: "คุณเช็คชื่อไปแล้ว" }, 400);
    }

    // 5️⃣ บันทึกการเช็คชื่อ
    await c.env.DB.prepare(
      `
        INSERT INTO attendance (session_id, student_id, status)
        VALUES (?, ?, 'present')
      `,
    )
      .bind(session.id, sid)
      .run();

    return c.json({
      success: true,
      message: "เช็คชื่อสำเร็จ ✅",
    });
  } catch (err) {
    console.error("CHECKIN ERROR:", err);
    return c.json({ message: "Internal Server Error" }, 500);
  }
});

/* ======================================================
   📥 Export CSV
====================================================== */
attendance.get("/export/:teacherId", async (c) => {
  try {
    const teacherId = Number(c.req.param("teacherId"));
    const dateParam = c.req.query("date");
    let date = (Array.isArray(dateParam) ? dateParam[0] : dateParam)?.trim();

    if (!date) {
      const row = await c.env.DB.prepare(
        `SELECT date('now','+7 hours') AS today`,
      ).first();
      date = row?.today;
    }

    const rows = await c.env.DB.prepare(
      `
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
    `,
    )
      .bind(teacherId, date, teacherId)
      .all();

    let csv = "ชื่อ-นามสกุล,รหัสนักศึกษา,สถานะ,เวลาเช็คชื่อ\n";

    rows.results.forEach((r: any) => {
      csv += `"${r.fullname}","${r.student_code}","${r.status}","${r.checked_at || ""}"\n`;
    });

    return c.body(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=attendance-${date}.csv`,
      },
    });
  } catch (err) {
    console.error(err);
    return c.text("Export failed", 500);
  }
});

/* ======================================================
   📤 Import รายชื่อนิสิต (CSV) - teacher only
====================================================== */
attendance.post("/students/import", async (c) => {
  try {
    const teacherId = Number(c.req.query("teacherId"));
    if (!teacherId) {
      return c.json({ message: "ไม่พบ teacherId" }, 400);
    }

    const form = await c.req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return c.json({ message: "ไม่พบไฟล์ CSV" }, 400);
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).slice(1);

    let processed = 0;

    for (const line of lines) {
      if (!line.trim()) continue;

      const [student_code, fullname] = line.split(",");
      if (!student_code || !fullname) continue;

      // 🔎 1. หา student ที่สมัครไว้ก่อน
      const existing = await c.env.DB.prepare(
        `
        SELECT id
        FROM students
        WHERE student_code = ?
      `,
      )
        .bind(student_code.trim())
        .first();

      let studentId: number | undefined;

      if (existing) {
        // ✅ 2. มีแล้ว → update teacher_id
        await c.env.DB.prepare(
          `
          UPDATE students
          SET fullname = ?, teacher_id = ?
          WHERE id = ?
        `,
        )
          .bind(fullname.trim(), teacherId, existing.id)
          .run();

        studentId = existing.id;
      } else {
        // ➕ 3. ไม่มี → insert ใหม่
        const result = await c.env.DB.prepare(
          `
          INSERT INTO students (student_code, fullname, teacher_id)
          VALUES (?, ?, ?)
          RETURNING id
        `,
        )
          .bind(student_code.trim(), fullname.trim(), teacherId)
          .first();

        studentId = result?.id;
      }

      if (!studentId) continue;

      

      processed++;
    }

    return c.json({
      success: true,
      message: `นำเข้า ${processed} คน สำเร็จ`,
    });
  } catch (err) {
    console.error("IMPORT ERROR:", err);
    return c.json({ message: "Import failed" }, 500);
  }
});

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
        `SELECT date('now','+7 hours') AS today`,
      ).first();
      date = row?.today;
    }

    const rows = await c.env.DB.prepare(
      `
      SELECT
        s.id AS student_id,
        s.user_id,
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
      `,
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
attendance.put("/update-status", async (c) => {
  try {
    const { studentId, sessionId, status } = await c.req.json();

    if (!["present", "leave", "absent"].includes(status)) {
      return c.json({ message: "status ไม่ถูกต้อง" }, 400);
    }

    // 🔎 เช็คว่ามี attendance ไหม
    const existing = await c.env.DB.prepare(
      `
      SELECT id FROM attendance
      WHERE student_id = ?
      AND session_id = ?
    `,
    )
      .bind(studentId, sessionId)
      .first();

    if (existing) {
      // มีแล้ว → update
      await c.env.DB.prepare(
        `
        UPDATE attendance
        SET status = ?
        WHERE id = ?
      `,
      )
        .bind(status, existing.id)
        .run();
    } else {
      // ไม่มี → insert ใหม่
      await c.env.DB.prepare(
        `
        INSERT INTO attendance (student_id, session_id, status)
        VALUES (?, ?, ?)
      `,
      )
        .bind(studentId, sessionId, status)
        .run();
    }

    return c.json({ success: true });
  } catch (err) {
    console.error(err);
    return c.json({ message: "อัปเดตไม่สำเร็จ" }, 500);
  }
});

/* ======================================================
   ❌ ถอนรายชื่อนักเรียนออกจากคลาส
====================================================== */
attendance.delete("/student/:studentId", async (c) => {
  try {
    const studentId = Number(c.req.param("studentId"));
    if (!studentId) {
      return c.json({ message: "studentId ไม่ถูกต้อง" }, 400);
    }

    // 🔎 หา teacher_id ก่อน (กันลบมั่ว)
    const student = await c.env.DB.prepare(
      `
      SELECT teacher_id
      FROM students
      WHERE id = ?
    `,
    )
      .bind(studentId)
      .first();

    if (!student?.teacher_id) {
      return c.json({ message: "นักเรียนไม่ได้อยู่ในคลาสใด" }, 400);
    }

    const teacherId = student.teacher_id;

    // 1️⃣ ลบ attendance เฉพาะของอาจารย์คนนี้
    await c.env.DB.prepare(
      `
      DELETE FROM attendance
      WHERE student_id = ?
      AND session_id IN (
        SELECT id FROM attendance_session WHERE teacher_id = ?
      )
    `,
    )
      .bind(studentId, teacherId)
      .run();

    // 2️⃣ ถอนออกจากคลาส (ไม่ลบ user)
    await c.env.DB.prepare(
      `
      UPDATE students
      SET teacher_id = NULL
      WHERE id = ?
    `,
    )
      .bind(studentId)
      .run();

    return c.json({ message: "ถอนรายชื่อนักเรียนออกจากคลาสแล้ว" });
  } catch (err) {
    console.error(err);
    return c.json({ message: "ถอนรายชื่อไม่สำเร็จ" }, 500);
  }
});

export default attendance;
