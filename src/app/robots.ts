import type { MetadataRoute } from "next";

/** Không cho crawler index: trang chứa dữ liệu phiên, không phải nội dung công khai. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
