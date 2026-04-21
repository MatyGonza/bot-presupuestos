export async function downloadTelegramAudio(botToken: string, filePath: string): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Error en la descarga de red: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
