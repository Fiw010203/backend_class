import { Hono } from "hono"
import openapi from "../openapi.js"

const docs = new Hono()

// Serve Swagger UI HTML (uses CDN for swagger-ui)
docs.get("/", (c) => {
  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@4/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger"></div>
    <script src="https://unpkg.com/swagger-ui-dist@4/swagger-ui-bundle.js"></script>
    <script>
      window.onload = function() {
        const ui = SwaggerUIBundle({
          url: '/docs/openapi.json',
          dom_id: '#swagger',
          deepLinking: true,
          presets: [
            SwaggerUIBundle.presets.apis
          ],
          layout: "BaseLayout"
        })
      }
    </script>
  </body>
  </html>`
  return c.html(html)
})

// Serve OpenAPI JSON
docs.get("/openapi.json", (c) => c.json(openapi))

export default docs
