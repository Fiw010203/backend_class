import { Hono } from "hono"


const getDb = (c: any) => c.env?.DB
const auth = new Hono()

/* ================= REGISTER ================= */
auth.get("/ping", (c) => c.text("pong"))

auth.post("/register", async (c) => {
  try {
    const { username, password, role, fullname, student_code } =
      await c.req.json()

    const db = getDb(c)
    const uname = username?.trim()

    /* ---------- validate ---------- */
    if (!uname || !password || !role) {
      return c.json({ message: "ข้อมูลไม่ครบ" }, 400)
    }

    const r = role.toLowerCase()
    if (r !== "student" && r !== "teacher") {
      return c.json({ message: "Role ไม่ถูกต้อง" }, 400)
    }

    if (r === "student") {
      if (!fullname || !student_code) {
        return c.json(
          { message: "กรุณากรอกข้อมูลนักศึกษาให้ครบ" },
          400
        )
      }
    }

    /* ---------- check duplicate username ---------- */
    const exists = await db
      .prepare("SELECT id FROM users WHERE username = ?")
      .bind(uname)
      .first()

    if (exists) {
      return c.json({ message: "Username ซ้ำ" }, 400)
    }

    /* ---------- insert users ---------- */
    const userResult = await db
      .prepare(
        `INSERT INTO users (username, password, role)
         VALUES (?, ?, ?)`
      )
      .bind(uname, password, r)
      .run()

    const userId =
      userResult.meta?.last_row_id ??
      (userResult as any)?.lastInsertRowid

    if (!userId) {
      return c.json(
        { message: "ไม่สามารถสร้างผู้ใช้ได้" },
        500
      )
    }

    /* ---------- insert student profile ---------- */
    if (r === "student") {
      await db
        .prepare(
          `INSERT INTO students (user_id, fullname, student_code)
           VALUES (?, ?, ?)`
        )
        .bind(userId, fullname, student_code)
        .run()
    }

    return c.json({
      success: true,
      message: "สมัครสมาชิกสำเร็จ ✅"
    })
  } catch (err) {
    console.error("REGISTER ERROR:", err)
    return c.json(
      { message: "สมัครไม่สำเร็จ: เกิดข้อผิดพลาด" },
      500
    )
  }
})

/* ================= LOGIN ================= */
auth.post("/login", async (c) => {
  try {
    const { username, password } = await c.req.json()

    if (!username || !password) {
      return c.json(
        { message: "กรุณากรอก Username และ Password" },
        400
      )
    }

    const db = getDb(c)
    if (!db) {
      console.error("LOGIN ERROR: DB not available")
      return c.json(
        { message: "Database not available" },
        500
      )
    }

    const user = await db
      .prepare(
        `SELECT id, username, role
         FROM users
         WHERE username = ? AND password = ?`
      )
      .bind(username.trim(), password)
      .first()

    if (!user) {
      return c.json(
        { message: "Username หรือ Password ไม่ถูกต้อง" },
        401
      )
    }

    return c.json({
      success: true,
      user
    })
  } catch (err) {
    console.error("LOGIN ERROR:", err)
    return c.json(
      { message: "Login error" },
      500
    )
  }
})


export default auth
