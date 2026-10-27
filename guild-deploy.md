# 🚀 คู่มือการติดตั้งระบบขึ้น Ubuntu Server (Step-by-Step Deployment Guide)
**สำหรับ URL: `http://it.technopark.kmutnb.ac.th/technosurfers/` (ผ่าน Nginx Proxy Manager)**

เอกสารนี้อธิบายขั้นตอนการนำเกม **TECHNO SURFERS 3D: 10 Floors to Space** ขึ้นรันบน **Ubuntu Server** และผูกเข้ากับ **Nginx Proxy Manager (NPM)** ที่คุณมีอยู่แล้วภายใต้ Path `/technosurfers` แบบครบวงจร

> 💡 **ความพิเศษที่ตั้งค่าไว้ในโค้ดให้เรียบร้อยแล้ว:**
> - ตัว Node Server (`server/index.ts` พอร์ต `8787`) รองรับทั้งการเรียกผ่าน Root (`/`) และผ่าน Subpath (`/technosurfers/...`) โดยอัตโนมัติ
> - ระบบแปลงลิงก์ `/technosurfers` เป็น `/technosurfers/` ให้อัตโนมัติเพื่อให้ไฟล์โมเดล 3D (`assets/core.glb`) โหลดได้ไม่หลุด Path
> - ระบบ WebSocket (`/technosurfers/ws`) และ **QR Code บนจอ TV** จะเปลี่ยนเป็น `http://it.technopark.kmutnb.ac.th/technosurfers/` โดยอัตโนมัติ
> - **ผู้เล่นสแกน QR Code ด้วยเน็ตมือถือ 4G / 5G จากค่ายไหนก็ได้** ไม่จำเป็นต้องต่อ Wi-Fi วงเดียวกับจอ TV อีกต่อไป!

---

## ขั้นตอนที่ 1: เตรียมเครื่อง Ubuntu Server (ติดตั้ง Node.js 20 LTS, Git และ PM2)

SSH เข้าไปที่เครื่อง Ubuntu Server แล้วรันคำสั่งต่อไปนี้ (ข้ามตัวที่มีในเครื่องแล้วได้):

```bash
# 1. อัปเดตแพ็กเกจและติดตั้ง Git
sudo apt update
sudo apt install -y curl git build-essential

# 2. ติดตั้ง Node.js 20 LTS (หากยังไม่มี Node 18/20+)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. ตรวจสอบเวอร์ชัน Node และ npm
node -v
npm -v

# 4. ติดตั้ง PM2 สำหรับคุมให้เซิร์ฟเวอร์ทำงานเบื้องหลังตลอด 24 ชม.
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

## ขั้นตอนที่ 3: รันเซิร์ฟเวอร์ด้วย PM2 ที่พอร์ต `8787`

```bash
# 1. สั่งรันเซิร์ฟเวอร์ผ่าน PM2 ตั้งชื่อว่า "techno-runner"
PORT=8787 pm2 start npm --name "techno-runner" -- run server

# 2. ตรวจสอบสถานะว่าขึ้นคำว่า "online"
pm2 status

# 3. บันทึกให้ PM2 เปิดกลับมาทำงานเองอัตโนมัติเวลาเครื่อง Ubuntu รีบูต
pm2 save
pm2 startup
```

ทดสอบว่าเซิร์ฟเวอร์ทำงานปกติบนเครื่อง Ubuntu ด้วยคำสั่ง:
```bash
curl http://127.0.0.1:8787/technosurfers/health
```
*(ถ้าสำเร็จ จะเห็นข้อมูล JSON ของห้องแข่งขันตอบกลับมาทันที)*

---

## ขั้นตอนที่ 4: ตั้งค่าใน Nginx Proxy Manager (สำหรับ `/technosurfers`)

เปิดหน้าเว็บ **Nginx Proxy Manager Admin UI** (ปกติพอร์ต `:81`) แล้วทำตามนี้ครับ:

1. ไปที่เมนู **Hosts** → **Proxy Hosts**
2. คลิกปุ่มจุด 3 จุดท้ายโดเมน **`it.technopark.kmutnb.ac.th`** แล้วเลือก **Edit**
3. ในแท็บแรก (**Details**):
   - เปิดสวิตช์ **Websockets Support** ให้เป็น **ON (สีเขียว)** *(สำคัญมากสำหรับการซิงก์มือถือกับจอ TV)*
4. ไปที่แท็บ **Advanced** (แนะนำวิธีนี้ชัวร์ที่สุดสำหรับ Subpath + WebSocket) แล้ววางโค้ดด้านล่างลงในช่อง **Custom Nginx Configuration**:

```nginx
# เปลี่ยน /technosurfers (ไม่มี /) ให้มี / ปิดท้ายอัตโนมัติ
location = /technosurfers {
    return 302 $scheme://$http_host/technosurfers/$is_args$args;
}

# ส่งต่อทั้งหน้าเว็บ 3D และ WebSocket (/technosurfers/ws) ไปยังพอร์ต 8787
location ^~ /technosurfers/ {
    proxy_pass http://127.0.0.1:8787/technosurfers/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
    proxy_buffering off;
    tcp_nodelay on;
}
```

> ⚠️ **หมายเหตุกรณี Nginx Proxy Manager รันอยู่ใน Docker Container:**
> - หาก Nginx Proxy Manager รันอยู่ใน Docker คนละ Container กับตัวเกม ให้เปลี่ยน `127.0.0.1:8787` ในบรรทัด `proxy_pass` เป็น **IP ภายในของเครื่อง Ubuntu Server** (เช่น `http://172.17.0.1:8787/technosurfers/` หรือ `http://192.168.x.x:8787/technosurfers/`)
> - เช็ค IP ของเครื่อง Ubuntu ได้ด้วยคำสั่ง `hostname -I | awk '{print $1}'`

5. กดปุ่ม **Save** เป็นอันเสร็จสมบูรณ์!

---

## ขั้นตอนที่ 5: ลิงก์เปิดใช้งานวันงานจริง

เมื่อตั้งค่าเสร็จแล้ว สามารถเปิดใช้งานผ่านลิงก์จริงได้ทันที:

- 📺 **ลิงก์สำหรับเปิดบนจอ TV กลางบูธ:**
  ```text
  http://it.technopark.kmutnb.ac.th/technosurfers/?mode=tv
  ```
- 📱 **ลิงก์สำหรับมือถือผู้เข้าชมงาน (หรือสแกนจาก QR Code บนจอ TV ได้เลย):**
  ```text
  http://it.technopark.kmutnb.ac.th/technosurfers/
  ```

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
- **รีสตาร์ทเซิร์ฟเวอร์เกม:**
  ```bash
  pm2 restart techno-runner
  ```
- **หาก Nginx Proxy Manager ใน Docker ต่อเข้าพอร์ต `8787` ไม่ได้ (ติด Firewall UFW):**
  ```bash
  sudo ufw allow 8787/tcp
  ```
