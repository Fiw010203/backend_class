import { Hono } from "hono"

type Env = {
  DB: D1Database
}

const auth = new Hono<{ Bindings: Env }>()

// ================= REGISTER =================
auth.post("/register", async (c) => {
  try {
    const { username, password, role, fullname, student_code } =
      await c.req.json()

    if (!username || !password || !role) {
      return c.json({ success: false, message: "ข้อมูลไม่ครบ" }, 400)
    }

    // normalize role
    let normalizedRole = role.toLowerCase()
    if (normalizedRole === "นักศึกษา") normalizedRole = "student"
    if (normalizedRole === "อาจารย์") normalizedRole = "teacher"

    if (normalizedRole !== "student" && normalizedRole !== "teacher") {
      return c.json({ success: false, message: "Role ไม่ถูกต้อง" }, 400)
    }

    // ตรวจสอบ username ซ้ำ
    const exists = await c.env.DB
      .prepare("SELECT id FROM users WHERE username = ?")
      .bind(username)
      .first()

    if (exists) {
      return c.json({ success: false, message: "Username ซ้ำ" }, 400)
    }

    // insert users
    const result = await c.env.DB
      .prepare(
        `INSERT INTO users (username, password, role)
         VALUES (?, ?, ?)`
      )
      .bind(username, password, normalizedRole)
      .run()

    const userId = result.meta.last_row_id

    // ถ้าเป็น student → insert students
    if (normalizedRole === "student") {
      await c.env.DB
        .prepare(
          `INSERT INTO students (user_id, fullname, student_code)
           VALUES (?, ?, ?)`
        )
        .bind(
          userId,
          fullname || username,
          student_code || null
        )
        .run()
    }

    return c.json({ success: true, message: "สมัครสำเร็จ ✅" })
  } catch (err) {
    console.error("❌ REGISTER ERROR:", err)
    return c.json(
      { success: false, message: "เกิดข้อผิดพลาดในการสมัคร" },
      500
    )
  }
})

// ================= LOGIN =================
auth.post("/login", async (c) => {
  try {
    const { username, password } = await c.req.json()

    const user = await c.env.DB
      .prepare(
        `SELECT id, username, role
         FROM users
         WHERE username = ? AND password = ?`
      )
      .bind(username, password)
      .first()

    if (!user) {
      return c.json(
        { success: false, message: "Username หรือ Password ไม่ถูกต้อง" },
        401
      )
    }

    return c.json({ success: true, user })
  } catch (err) {
    console.error("❌ LOGIN ERROR:", err)
    return c.json(
      { success: false, message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ" },
      500
    )
  }
})

export default auth
