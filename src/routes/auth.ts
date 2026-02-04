import { Hono } from "hono"

const auth = new Hono()
const getDb = (c: any) => c.env?.my_db

// REGISTER
auth.post("/register", async (c) => {
  try {
    const { username, password, role, fullname, student_code } = await c.req.json()
    const db = getDb(c)
    // ตรวจสอบข้อมูลที่จำเป็น
    if (!username || !password || !role) {
      return c.json({ success: false, message: "ข้อมูลไม่ครบ" }, 400)
    }

    // normalize role ให้รองรับทั้งภาษาอังกฤษและไทย
    let normalizedRole = role.toLowerCase()
    if (normalizedRole === "นักศึกษา") normalizedRole = "student"
    if (normalizedRole === "อาจารย์") normalizedRole = "teacher"

    // Validate role (must be either student or teacher)
    if (normalizedRole !== "student" && normalizedRole !== "teacher") {
      return c.json({ success: false, message: "Role ไม่ถูกต้อง" }, 400)
    }

    // ตรวจสอบ username ซ้ำ
    const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username)
    if (exists) {
      return c.json({ success: false, message: "Username ซ้ำ" }, 400)
    }

    // บันทึกลงตาราง users (ไม่มี fullname)
    const result = db.prepare(`
      INSERT INTO users (username, password, role)
      VALUES (?, ?, ?)
    `).run(username, password, normalizedRole)

    const userId = result.lastInsertRowid

    // ถ้า role เป็น student → บันทึกลงตาราง students
    if (normalizedRole === "student") {
      db.prepare(`
        INSERT INTO students (user_id, fullname, student_code)
        VALUES (?, ?, ?)
      `).run(userId, fullname || username, student_code || null)
    }

    return c.json({ success: true, message: "สมัครสำเร็จ ✅" })
  } catch (err) {
    console.error("❌ REGISTER ERROR:", err)
    return c.json({ success: false, message: "เกิดข้อผิดพลาดในการสมัคร" }, 500)
  }
})

// LOGIN
auth.post("/login", async (c) => {
  try {
    const { username, password } = await c.req.json()
    const db = getDb(c)
    const user = db.prepare(`
      SELECT id, username, role
      FROM users
      WHERE username = ? AND password = ?
    `).get(username, password)

    if (!user) {
      return c.json({ success: false, message: "Username หรือ Password ไม่ถูกต้อง" }, 401)
    }

    return c.json({ success: true, user })
  } catch (err) {
    console.error("❌ LOGIN ERROR:", err)
    return c.json({ success: false, message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ" }, 500)
  }
})



export default auth
