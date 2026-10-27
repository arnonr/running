# 🚀 คู่มือการติดตั้งระบบขึ้น Ubuntu Server (Step-by-Step Deployment Guide)

เอกสารนี้อธิบายขั้นตอนการนำเกม **TECHNO SURFERS 3D: 10 Floors to Space** ขึ้นรันบน **Ubuntu Server (20.04 / 22.04 / 24.04 LTS)** แบบครบวงจร

> 💡 **ข้อดีของการรันบน Ubuntu Server จริง:**
> - เซิร์ฟเวอร์ตัวเดียว (`server/index.ts`) ทำหน้าที่เสิร์ฟทั้ง **หน้าเว็บเกม 3D (`dist/`)** และ **WebSocket ซิงก์ข้อมูลเรียลไทม์ (`/ws`)** ในพอร์ตเดียวกัน (`8787`)
> - **มือถือผู้เล่นไม่จำเป็นต้องต่อ Wi-Fi วงเดียวกับจอ TV อีกต่อไป!** ผู้เข้าชมงานสามารถใช้เน็ตมือถือ **4G / 5G** สแกน QR Code บนจอ TV แล้วเข้ามาวิ่งพร้อมกันบนจอ TV ได้ทันที

---

## ขั้นตอนที่ 1: เตรียมเครื่อง Ubuntu Server (ติดตั้ง Node.js 20 LTS, Git และ PM2)

SSH เข้าไปที่เครื่อง Ubuntu Server แล้วรันคำสั่งต่อไปนี้ทีละบรรทัด:

```bash
# 1. อัปเดตแพ็กเกจของ Ubuntu
sudo apt update && sudo apt upgrade -y

# 2. ติดตั้งเครื่องมือพื้นฐานและ Git
sudo apt install -y curl git build-essential ufw

# 3. ติดตั้ง Node.js 20 LTS (ผ่าน NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 4. ตรวจสอบเวอร์ชัน Node และ npm (ควรได้ Node v20.x ขึ้นไป)
node -v
npm -v

# 5. ติดตั้ง PM2 สำหรับคุมให้เซิร์ฟเวอร์ทำงานเบื้องหลังตลอด 24 ชม.
sudo npm install -g pm2
```

---

## ขั้นตอนที่ 2: ดึงโค้ดจาก GitHub และสั่ง Build โปรเจกต์

```bash
# 1. สร้างโฟลเดอร์เก็บโปรเจกต์ (เช่น /var/www) และเข้าไปข้างใน
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
cd /var/www

# 2. Clone โค้ดจาก GitHub ของคุณ
git clone https://github.com/arnonr/running.git
cd running

# 3. ติดตั้ง Dependencies ทั้งหมด
npm install

# 4. สั่ง Build ไฟล์หน้าเว็บ 3D สำหรับ Production (จะได้โฟลเดอร์ dist/)
npm run build
```

---

## ขั้นตอนที่ 3: รันเซิร์ฟเวอร์ด้วย PM2 (ทำงานตลอดเวลา + เปิดเองเมื่อ Server Reboot)

ตัวไฟล์ `server/index.ts` จะทำหน้าที่เปิดทั้ง **เว็บหน้าบ้าน (`dist/`)** และ **WebSocket Server (`/ws`)** ที่พอร์ต `8787` พร้อมกันในโปรเซสเดียว:

```bash
# 1. สั่งรันเซิร์ฟเวอร์ผ่าน PM2 ตั้งชื่อว่า "techno-runner"
PORT=8787 pm2 start npm --name "techno-runner" -- run server

# 2. ตรวจสอบสถานะว่าขึ้นคำว่า "online"
pm2 status
pm2 logs techno-runner --lines 20

# 3. บันทึกให้ PM2 เปิดกลับมาทำงานเองอัตโนมัติเวลาเครื่อง Ubuntu รีบูต
pm2 save
pm2 startup
# (หมายเหตุ: หากคำสั่ง pm2 startup แสดงบรรทัดที่ขึ้นต้นด้วย sudo env PATH=... ให้ก๊อปปี้บรรทัดนั้นมารันต่อ עוד 1 ครั้ง แล้วพิมพ์ pm2 save อีกที)
```

ทดสอบว่าเซิร์ฟเวอร์ทำงานปกติด้วยคำสั่ง:
```bash
curl http://localhost:8787/health
```
*(ถ้าสำเร็จ จะเห็นข้อมูล JSON สถานะห้องแข่งขันตอบกลับมา)*

---

## ขั้นตอนที่ 4: เปิดให้เข้าใช้งานจากภายนอก (เลือกแบบ A หรือ แบบ B)

### แบบที่ A: เข้าผ่าน IP Server โดยตรง (ง่ายและเร็วที่สุด ไม่ต้องมีโดเมน)
หากต้องการเข้าผ่าน `http://<IP-ของ-Server>:8787` เลย เพียงเปิดพอร์ต `8787` บน Firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8787/tcp
sudo ufw enable
```
เสร็จแล้วเปิดใช้งานได้ทันทีที่:
- **หน้าจอ TV:** `http://<IP-ของ-Server>:8787/?mode=tv`
- **หน้าจอมือถือ (สร้างใน QR อัตโนมัติ):** `http://<IP-ของ-Server>:8787/`

---

### แบบที่ B: เข้าผ่านชื่อโดเมนมาตรฐาน + HTTPS (Nginx Reverse Proxy + SSL ฟรี)
แนะนำสำหรับงานจริงที่ต้องการลิงก์สวยๆ (เช่น `https://run.yourdomain.com`) โดยไม่ต้องพิมพ์เลขพอร์ต `:8787`

#### 4.1 ติดตั้ง Nginx
```bash
sudo apt install -y nginx
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

#### 4.2 สร้างไฟล์ตั้งค่า Nginx
```bash
sudo nano /etc/nginx/sites-available/techno-runner
```
วางโค้ดด้านล่างลงไป *(เปลี่ยน `run.yourdomain.com` เป็นชื่อโดเมนหรือ IP ของคุณ)*:

```nginx
server {
    listen 80;
    server_name run.yourdomain.com;

    # เปิด TCP_NODELAY เพื่อลดความหน่วง (Latency) ระหว่างมือถือและจอ TV สูงสุด
    tcp_nodelay on;

    # ส่งต่อ WebSocket (/ws) ไปยัง Node Server พอร์ต 8787
    location /ws {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }

    # ส่งต่อหน้าเว็บและไฟล์ 3D ทั้งหมดไปยัง Node Server พอร์ต 8787
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

บันทึกไฟล์ (`Ctrl+O` → `Enter` → `Ctrl+X`) แล้วเปิดใช้งานไซต์:

```bash
sudo ln -s /etc/nginx/sites-available/techno-runner /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 4.3 (ถ้ามีโดเมน) ติดตั้ง SSL (`https://` และ `wss://`) ฟรีด้วย Certbot
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d run.yourdomain.com
```

---

## ขั้นตอนที่ 5: วิธีเปิดใช้งานหน้างานจริง

1. **บนคอมพิวเตอร์ที่ต่อออกจอ TV กลางบูธ:**
   - เปิดเบราว์เซอร์ Chrome กด `F11` (Full Screen) แล้วเข้าลิงก์:
     - `https://run.yourdomain.com/?mode=tv` *(หรือ `http://<IP-ของ-Server>:8787/?mode=tv`)*
   - **QR Code มุมซ้ายบนของจอ TV** จะสร้างลิงก์ตามชื่อโดเมน/IP ของ Server ให้โดยอัตโนมัติ!
2. **บนมือถือของผู้ร่วมงาน:**
   - เปิดกล้องมือถือสแกน QR Code บนจอ TV (ใช้เน็ตมือถือ 4G/5G หรือ Wi-Fi อะไรก็ได้)
   - พิมพ์ชื่อเล่น เลือกตัวละคร 3D แล้วกดปุ่มสีทอง **✅ ยืนยันตัวละคร · เข้าจุดปล่อยตัว**
3. **พิธีกรประจำบูธ (ควบคุมจากหน้าจอ TV):**
   - ปรับจำนวนบอทได้ตลอดเวลาด้วยปุ่ม **`➕ เพิ่มบอท`**, **`➖ ลดบอท`**, หรือ **`🤖 ล้างบอท (0)`**
   - เลือกเวลาแข่งขัน (`3 นาที`, `2 นาที`, `1.5 นาที`)
   - กดปุ่มสีเขียว **`🚀 เริ่มปล่อยตัวรอบนี้ / เริ่มใหม่ (Admin Start)`** เพื่อให้ผู้เล่นทุกคนนับถอยหลัง 3..2..1 และออกวิ่งพร้อมกัน!

---

## ขั้นตอนที่ 6: วิธีอัปเดตโค้ดใหม่ขึ้น Ubuntu Server ในอนาคต

เมื่อมีการแก้ไขโค้ดและ `git push` ขึ้น GitHub แล้ว ให้รันเพียง 3 คำสั่งนี้บน Ubuntu Server:

```bash
cd /var/www/running
git pull origin main
npm run build
pm2 restart techno-runner
```

---

## 🛠️ คำสั่งตรวจสอบและแก้ปัญหาเบื้องต้น (Troubleshooting)

- **ดู Log การทำงานของเซิร์ฟเวอร์แบบเรียลไทม์:**
  ```bash
  pm2 logs techno-runner
  ```
- **รีสตาร์ทเซิร์ฟเวอร์เกม (ล้างห้องใหม่ทั้งหมด):**
  ```bash
  pm2 restart techno-runner
  ```
- **ตรวจสอบว่าพอร์ต `8787` เปิดทำงานอยู่หรือไม่:**
  ```bash
  sudo ss -tulpn | grep 8787
  ```
