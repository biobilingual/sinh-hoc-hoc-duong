# BioBilingual

Nền tảng học Sinh học song ngữ dành cho học sinh THPT.

## Cấu trúc mã nguồn

- `apps/student/`: Website học sinh (Từ vựng, Học liệu, Luyện tập, Bảng xếp hạng).
- `apps/admin/`: Website quản trị để cập nhật nội dung, học liệu, từ vựng và đề thi.
- `services/content-api/`: API dùng D1 để lưu hồ sơ học sinh, kết quả học tập và dữ liệu được đồng bộ từ trang quản trị.

## Bảo mật và biến môi trường

Không đưa các giá trị bí mật lên GitHub. Cấu hình các giá trị sau trong **Environment Variables** của hosting:

- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_SECRET`
- `DATABASE_URL`
- mật khẩu cơ sở dữ liệu và khóa API khác

Google Client ID có thể xuất hiện ở phía trình duyệt vì đây là mã công khai. Google Client Secret chỉ được dùng ở phía máy chủ và không được commit.

## Phát hành

Nhánh `main` là phiên bản production. Trước khi phát hành, cần kiểm tra không có tệp `.env`, khóa riêng hoặc mật khẩu trong thay đổi mới.
