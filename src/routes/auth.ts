import { Hono } from "hono";

type Env = {
  DB: D1Database;
};

const auth = new Hono<{ Bindings: Env }>();
const getDb = (c: any) => c.env.DB;

/* ================= HEALTH ================= */
auth.get("/ping", (c) => c.text("pong"));

/* ================= REGISTER ================= */
/* ================= REGISTER ================= */
auth.post("/register", async (c) => {
  try {
    const { username, password, role, fullname, student_code } =
      await c.req.json()

    const db = getDb(c)

    const uname = username?.trim()
    const pwd = password?.toString()
    const r = role?.toLowerCase()

    /* ---------- validate ---------- */
    if (!uname || !pwd || !r) {
      return c.json({ message: "ข้อมูลไม่ครบ" }, 400)
    }

    if (r !== "student" && r !== "teacher") {
      return c.json({ message: "Role ไม่ถูกต้อง" }, 400)
    }

    if (r === "student") {
      if (!fullname || !student_code) {
        return c.json({ message: "กรุณากรอกข้อมูลนักศึกษาให้ครบ" }, 400)
      }
    }

    /* ---------- duplicate username ---------- */
    const usernameExists = await db
      .prepare(`SELECT id FROM users WHERE username = ?`)
      .bind(uname)
      .first()

    if (usernameExists) {
      return c.json({ message: "Username ซ้ำ" }, 400)
    }

    /* ---------- insert users ---------- */
    const result = await db
      .prepare(`
        INSERT INTO users (username, password, role)
        VALUES (?, ?, ?)
      `)
      .bind(uname, pwd, r)
      .run()

    const userId = result.meta?.last_row_id
    if (!userId) {
      return c.json({ message: "สร้างผู้ใช้ไม่สำเร็จ" }, 500)
    }

    /* ---------- student logic (สำคัญ) ---------- */
    if (r === "student") {
      // 🔍 เช็กว่าถูก import มาก่อนหรือไม่
      const existingStudent = await db
        .prepare(`
          SELECT id FROM students
          WHERE student_code = ?
        `)
        .bind(student_code.trim())
        .first()

      if (existingStudent) {
        // ✅ มีแล้ว → update user_id
        await db
          .prepare(`
            UPDATE students
            SET user_id = ?, fullname = ?
            WHERE id = ?
          `)
          .bind(
            userId,
            fullname.trim(),
            existingStudent.id
          )
          .run()
      } else {
        // 🆕 ยังไม่เคย import → insert ใหม่
        await db
          .prepare(`
            INSERT INTO students (user_id, fullname, student_code)
            VALUES (?, ?, ?)
          `)
          .bind(
            userId,
            fullname.trim(),
            student_code.trim()
          )
          .run()
      }
    }

    return c.json({
      success: true,
      message: "สมัครสมาชิกสำเร็จ ✅"
    })
  } catch (err) {
    console.error("REGISTER ERROR:", err)
    return c.json({ message: "สมัครไม่สำเร็จ" }, 500)
  }
})


/* ================= LOGIN (แก้แล้ว) ================= */
auth.post("/login", async (c) => {
  try {
    const { username, password } = await c.req.json()

    const uname = username?.trim()
    const pwd = password?.toString()

    if (!uname || !pwd) {
      return c.json(
        { success: false, message: "กรุณากรอก Username และ Password" },
        400
      )
    }

    const db = getDb(c)
    if (!db) {
      console.error("DB is undefined")
      return c.json(
        { success: false, message: "Database not connected" },
        500
      )
    }

    const user = await db
      .prepare(
        `
        SELECT
          u.id,
          u.username,
          u.role,
          s.id AS student_id
        FROM users u
        LEFT JOIN students s ON u.id = s.user_id
        WHERE u.username = ? AND u.password = ?
        `
      )
      .bind(uname, pwd)
      .first()

    if (!user) {
      return c.json(
        { success: false, message: "Username หรือ Password ไม่ถูกต้อง" },
        401
      )
    }

    return c.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        student_id: user.role === "student" ? user.student_id : null,
      },
    })
  } catch (err) {
    console.error("LOGIN ERROR:", err)
    return c.json({ success: false, message: "Login error" }, 500)
  }
})


export default auth;
