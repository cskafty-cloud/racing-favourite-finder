const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

async function main() {
  const source = path.join(__dirname, "..", "public", "logo.jpg");
  const output = path.join(__dirname, "icon.ico");
  if (!fs.existsSync(source)) {
    throw new Error("Website logo not found at public/logo.jpg");
  }

  // Windows ICO files can contain a PNG image. Keep the complete website
  // logo visible inside a square canvas rather than cropping its edges.
  const png = await sharp(source, { failOn: "none" })
    .resize(256, 256, {
      fit: "contain",
      background: { r: 8, g: 13, b: 24, alpha: 1 }
    })
    .png()
    .toBuffer();

  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);       // Reserved
  header.writeUInt16LE(1, 2);       // ICO resource type
  header.writeUInt16LE(1, 4);       // Number of images
  header.writeUInt8(0, 6);          // Width 256
  header.writeUInt8(0, 7);          // Height 256
  header.writeUInt8(0, 8);          // Palette
  header.writeUInt8(0, 9);          // Reserved
  header.writeUInt16LE(1, 10);      // Color planes
  header.writeUInt16LE(32, 12);     // Bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);

  fs.writeFileSync(output, Buffer.concat([header, png]));
  console.log("Created Windows icon from public/logo.jpg:", output);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
