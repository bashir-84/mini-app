# چالش کوتاه استدلال

مینی‌اپ فارسی تلگرام برای آزمون کلاسی، همراه با پنل معلم. صفحه‌ها و API روی Cloudflare Workers اجرا می‌شوند و D1 پاسخ‌ها و امتیاز را نگه می‌دارد.

## پروژه

- `public/` رابط دانش‌آموز و پنل معلم
- `src/worker.mjs` API، احراز هویت، کنترل عضویت و تصحیح
- `migrations/` ساخت دیتابیس و نوبت اولیه
- `scripts/create-teacher.mjs` ساخت حساب معلم با کلید تصادفی
- `report.sql` گزارش هر ثبت در D1
- `tests/` تست گردش کار با سؤال‌های ساختگی

سؤال‌های کلاس و کلید پاسخ در D1 خصوصی قرار دارند. برای یک دیتابیس جدید، پس از migration، سؤال‌ها و کلید را با SQL خصوصی در جدول questions وارد کن. پایگاه دادهٔ فعلی از قبل مقداردهی شده است.

## انتشار و اتصال

از ریشهٔ پروژه و پس از ورود به حساب Cloudflare:

```bash
npx wrangler deploy
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

در BotFather، آدرس ریشهٔ Worker را به‌عنوان URL برنامهٔ اصلی بات ثبت کن. لینک کلاس به شکل `https://t.me/YOUR_BOT?startapp=reasoning-01` است. پنل معلم در مسیر `/teacher/` قرار دارد.

## ایجاد حساب معلم

```bash
node scripts/create-teacher.mjs teacher class-1
npx wrangler d1 execute class-reasoning-quiz --remote --file=teacher-local.sql
```

کلید را خصوصی نگه دار. معلم پس از ورود می‌تواند درخواست‌ها را تأیید کند و ثبت‌های همان کلاس را ببیند. پایان آزمون و انتشار جدول در یک اقدام انجام می‌شود.

## تست

```bash
node --test tests/flow.test.mjs
```
