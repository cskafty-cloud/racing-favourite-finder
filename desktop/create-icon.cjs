const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

async function main() {
  const source = path.join(__dirname, "..", "public", "logo.jpg");
  const output = path.join(__dirname, "icon.ico");
  if (!fs.existsSync(source)) {
    throw new Error("Website logo not found at public/logo.jpg");
  }

  // Release builds use the exact same logo artwork served by the live website (public/logo.jpg).
  // Transparent padding keeps the logo intact without adding a different
  // background or cropping any of the website's artwork.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map((size) =>
      sharp(source, { failOn: "none" })
        .resize(size, size, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer()
    )
  );

  const headerSize = 6 + sizes.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // ICO resource type
  header.writeUInt16LE(sizes.length, 4);

  let offset = headerSize;
  images.forEach((png, index) => {
    const entry = 6 + index * 16;
    const size = sizes[index];
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2); // Palette
    header.writeUInt8(0, entry + 3); // Reserved
    header.writeUInt16LE(1, entry + 4); // Color planes
    header.writeUInt16LE(32, entry + 6); // Bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  fs.writeFileSync(output, Buffer.concat([header, ...images]));
  console.log("Created multi-size Windows icon directly from public/logo.jpg:", output);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
