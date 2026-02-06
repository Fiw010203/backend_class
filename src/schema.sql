-- ผู้ใช้
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT
);

-- นักศึกษา
CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, -- FK ไป users.id
  fullname TEXT,
  student_code TEXT,
  teacher_id INTEGER,
  UNIQUE(student_code, teacher_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (teacher_id) REFERENCES users(id)
);

-- 👨‍🏫 คาบเรียน / session
CREATE TABLE attendance_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER,
  code TEXT,
  expires_at DATETIME,
  created_at DATETIME DEFAULT (datetime('now','+7 hours')),
  FOREIGN KEY(teacher_id) REFERENCES users(id)
);

-- 👨‍🎓 การเช็คชื่อ
CREATE TABLE attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  student_id INTEGER,
  checked_at DATETIME DEFAULT (datetime('now','+7 hours')),
  FOREIGN KEY(session_id) REFERENCES attendance_session(id),
  FOREIGN KEY(student_id) REFERENCES students(id)
);
