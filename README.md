# Backend Setup Instructions
### 1. Clone the backend repo
```
git clone https://github.com/Korrawit-aoongern/backend-cw
cd backend-cw
npm install
```

### 2. Create new D1 database
```
wrangler d1 create your-database-name
```

output:
```
🌀 Creating database...
✅ Database created!

database_name = "my-db"
database_id   = "abcd1234-ef56-7890-aaaa-bbbbccccdddd"
```

Copy database_id for the next step.

### 3. Go to wrangler.jsonc
```
"d1_databases": [
  {
    "binding": "my_db",
    "database_name": "my-db",
    "database_id": "PASTE-THEIR-OWN-ID-HERE"
  }
]
```

### 4. Run the migrations

local db:
```
wrangler d1 execute my-db --file=./src/schema.sql
```

remote db:
```
wrangler d1 execute your-database-name --file=./src/schema.sql --remote
```

### 5. Start the development server
```
wrangler dev
```
or
```
npm run dev
```

### 6. Deploy
```
wrangler deploy
```
or
```
npm run deploy
```

Wrangler will output:
```
https://backend-cw.username.workers.dev
```
นั่นคือ URL ของ backend ของคุณ
สำหรับเชื่อมต่อกับ frontend ในการรัน
```
docker run -p 8080:80 -e API_BASE=https://backend-cw.username.workers.dev yuzuruorensu/cw-crud:v1f
```
