import { Hono } from "hono"

import { cors } from "hono/cors"
import auth from "./routes/auth.js"
import attendance from "./routes/attendance.js"

const app = new Hono()

app.use("*", cors())

app.get('/', (c) => c.text('Hello Hono!'))

app.route("/auth", auth)
app.route("/attendance", attendance)

export default app