const openapi = {
  openapi: "3.0.0",
  info: {
    title: "Attendance System API",
    version: "1.0.0",
    description: "Simple OpenAPI description for the attendance system backend"
  },
  servers: [
    { url: "/" }
  ],
  paths: {
    "/auth/register": {
      post: {
        summary: "Create a new user",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RegisterRequest" }
            }
          }
        },
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MessageResponse" }
              }
            }
          },
          "400": { description: "Bad Request", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "500": { description: "Server Error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    },
    "/auth/login": {
      post: {
        summary: "Login",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginRequest" }
            }
          }
        },
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    user: { $ref: "#/components/schemas/User" }
                  }
                }
              }
            }
          },
          "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "500": { description: "Server Error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      }
    }
  },
  components: {
    schemas: {
      RegisterRequest: {
        type: "object",
        required: ["username", "password", "role"],
        properties: {
          username: { type: "string" },
          password: { type: "string" },
          role: { type: "string", enum: ["student", "teacher"] },
          fullname: { type: "string" },
          student_code: { type: "string" }
        }
      },
      LoginRequest: { type: "object", required: ["username", "password"], properties: { username: { type: "string" }, password: { type: "string" } } },
      User: { type: "object", properties: { id: { type: "integer" }, username: { type: "string" }, role: { type: "string" } } },
      MessageResponse: { type: "object", properties: { message: { type: "string" } } },
      ErrorResponse: { type: "object", properties: { message: { type: "string" } } }
    }
  }
}

export default openapi
