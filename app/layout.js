export const metadata = {
  title: "Noticed",
  description: "A quieter way to love the people who matter.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#F4F0E6" }}>{children}</body>
    </html>
  );
}
