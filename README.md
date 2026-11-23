# استوديو شورتس الأسئلة (YouTube Shorts Quiz Studio)

استوديو متكامل لصناعة فيديوهات **يوتيوب شورتس (9:16 - 1080×1920)** وفيديوهات العرض (**16:9 - 1920×1080**) للأسئلة والألغاز، مع تحكم كامل في التصميم، المؤقت العدّاد، المؤثرات الصوتية، المونتاج بالذكاء الاصطناعي، وتصدير الفيديو مباشرة بجودة عالية.

---

## 1. النشر المباشر على GitHub Pages (بدون خادم خارجي)

المشروع مجهّز بالكامل للعمل والنشر تلقائياً على **GitHub Pages** عبر ملف `.github/workflows/deploy-github-pages.yml` مع **تدوير تلقائي لعدة مفاتيح Gemini** لتجاوز حدود الحصة اليومية.

### خطوات التفعيل على مستودع `MuhammedNime/Shortvedio2`:
1. ارفع ملفات هذا المشروع إلى المستودع:
   https://github.com/MuhammedNime/Shortvedio2
2. افتح المستودع على GitHub ثم اذهب إلى:
   **Settings > Secrets and variables > Actions > New repository secret**
   وأضف مفاتيح Gemini بأي من الطريقتين (أو كلتيهما معاً):
   - **`GEMINI_API_KEY`**: المفتاح الأساسي.
   - **`GEMINI_API_KEYS`**: قائمة بعدة مفاتيح إضافية مفصولة بفاصلة أو سطر جديد (مثال: `key2,key3,key4`).
   - أو أسراراً منفصلة مرقّمة من **`GEMINI_API_KEY_1`** حتى **`GEMINI_API_KEY_10`**.
3. فعّل النشر من **Settings > Pages** واختر في **Source**:
   **GitHub Actions**
4. بعد انتهاء التشغيل في تبويب **Actions** سيصبح التطبيق متاحاً مباشرة على الرابط:
   **https://muhammednime.github.io/Shortvedio2/**

> **توصية أمان مهمة:** لأن GitHub Pages موقع ثابت يعمل من المتصفح، يُنصح بتقييد مفاتيح Gemini في Google AI Studio / Google Cloud Console تحت **Application restrictions > Websites (HTTP referrers)** لتعمل فقط على:
> `https://muhammednime.github.io/*`

---

## 2. استخراج ملف Android APK تلقائياً عبر GitHub Actions

المشروع مجهّز أيضاً بملف `.github/workflows/build-android-apk.yml` ويستخدم نفس أسرار `GEMINI_API_KEY` / `GEMINI_API_KEYS` / `GEMINI_API_KEY_1..10`:
1. افتح تبويب **Actions** واختر **Build Debug APK**.
2. بعد انتهاء البناء، حمّل **`shorts-quiz-studio-debug-apk`** وبداخله **`app-debug.apk`**.

---

## 3. تشغيل المشروع محلياً للتطوير

```bash
npm install
npm run dev
```

سيعمل التطبيق وخادم الذكاء الاصطناعي على المنفذ `http://localhost:3000`.
