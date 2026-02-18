# דשבורד COMEX Silver (עברית) – פרו

כולל:
- KPI: Total / Registered / Eligible
- שינוי יומי + אחוז שינוי (מול `Prev Total`)
- גרף 30 יום (Total) + מדדים: שינוי מצטבר, סטיית תקן, ממוצע שינוי 7 ימים
- טבלאות: Top 8 מחסנים לפי סה״כ, Top 5 “מי זז הכי הרבה היום”
- הורדת CSV 30 יום, קישור למקור רשמי
- תזכורת קבועה בצד העמוד: **Not your keys, not your coin**

מקור רשמי: CME Group – `Silver_stocks.xls`  
https://www.cmegroup.com/delivery_reports/Silver_stocks.xls

---

## הרצה מקומית
```bash
npm install
npm run dev
```
פתח: http://localhost:3000

---

## פריסה ציבורית (Vercel)
1) העלה את הפרויקט ל-GitHub
2) Vercel → New Project → בחר את הריפו → Deploy  
תקבל לינק ציבורי כמו: `https://your-project.vercel.app`

---

## היסטוריה לגרף (אוטומטי)
הדוח של CME הוא יומי (קובץ אחד). כדי לבנות גרף 30 יום יש מנגנון אוטומטי:
- GitHub Actions מריץ פעם ביום `npm run update-history`
- זה מעדכן את `public/data/history.json`
- Vercel עושה redeploy ומציג גרף מעודכן

Workflow מוכן:
`.github/workflows/update-history.yml`

אפשר גם להריץ ידנית ב-GitHub Actions: **Run workflow**

---

## עדכון ידני להיסטוריה
```bash
npm run update-history
```
