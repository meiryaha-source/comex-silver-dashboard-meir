export const metadata = {
  title: "דשבורד COMEX Silver",
  description: "דשבורד מקצועי למלאי כסף (Registered/Eligible/Total) ב-COMEX מתוך הדוח הרשמי של CME."
};

export default function RootLayout({ children }) {
  return (
    <html lang="he">
      <body
        style={{
          margin: 0,
          background:
            "radial-gradient(1200px 600px at 15% 10%, rgba(125,211,252,0.16), transparent 55%)," +
            "radial-gradient(900px 500px at 85% 0%, rgba(34,197,94,0.10), transparent 50%)," +
            "radial-gradient(900px 500px at 70% 90%, rgba(168,85,247,0.12), transparent 55%)," +
            "#070b14",
          color: "#e6edf3"
        }}
      >
        {children}
      </body>
    </html>
  );
}
