CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  fullname TEXT,
  student_code TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS attendance_code (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  teacher_id INTEGER,
  expires_at DATETIME,
  FOREIGN KEY(teacher_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER,
  code TEXT,
  checked_at DATETIME DEFAULT (datetime('now', '+7 hours')),
  FOREIGN KEY(student_id) REFERENCES users(id)
);