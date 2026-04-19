# TG CRM

A Telegram CRM that lets you log in and manage multiple Telegram accounts from one interface.

## Setup

### 1. Get Telegram API credentials
1. Go to https://my.telegram.org
2. Log in with your phone number
3. Click "API development tools"
4. Create an app (any name) and copy your `api_id` and `api_hash`

### 2. Configure the server
Edit `server/.env`:
```
API_ID=your_api_id_here
API_HASH=your_api_hash_here
```

### 3. Install & run the server
```bash
cd server
npm install
node index.js
```

Server runs on http://localhost:3333

### 4. Open the app
Open `index.html` in your browser (or serve it with any static server).

## Usage
- Click **+** in the sidebar to add a Telegram account
- Enter your phone number → receive OTP → enter code
- Supports 2FA accounts automatically
- Click any account to load its conversations
- Click a conversation to view messages and reply

## API Endpoints
- `POST /auth/send-code` — send OTP to phone
- `POST /auth/verify-code` — verify OTP, complete login
- `POST /auth/verify-2fa` — verify 2FA password
- `GET /accounts` — list connected accounts
- `GET /accounts/:id/dialogs` — get conversations
- `GET /accounts/:id/messages/:peerId` — get messages
- `POST /accounts/:id/send` — send a message
- `DELETE /accounts/:id` — disconnect account
