import type { TextPrintResult } from "@erp/contracts";

/**
 * Envía bytes ESC/POS a una impresora conectada al equipo del usuario, sin diálogo de impresión:
 * USB con WebUSB y puerto serie (o USB-serie/Bluetooth emparejado) con Web Serial. Solo en Chrome/Edge y con permiso del usuario.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function sendToLocalPrinter(result: TextPrintResult): Promise<void> {
  const bytes = Uint8Array.from(atob(result.dataBase64), (c) => c.charCodeAt(0));
  if (result.connection === "USB") {
    const usb = (navigator as any).usb;
    if (!usb) throw new Error("Este navegador no permite imprimir por USB. Usa Chrome o Edge, o configura la impresora por red.");
    const device = await usb.requestDevice({ filters: [] }); // el usuario elige su impresora en la ventana del navegador
    await device.open();
    if (!device.configuration) await device.selectConfiguration(1);
    let out: { iface: number; ep: number } | null = null;
    for (const i of device.configuration.interfaces) {
      const alt = i.alternates.find((a: any) => a.endpoints.some((e: any) => e.direction === "out"));
      if (alt) { out = { iface: i.interfaceNumber, ep: alt.endpoints.find((e: any) => e.direction === "out").endpointNumber }; break; }
    }
    if (!out) throw new Error("No se encontró un canal de salida en esa impresora USB.");
    await device.claimInterface(out.iface);
    await device.transferOut(out.ep, bytes);
    await device.releaseInterface(out.iface).catch(() => undefined);
    await device.close().catch(() => undefined);
    return;
  }
  if (result.connection === "SERIAL") {
    const serial = (navigator as any).serial;
    if (!serial) throw new Error("Este navegador no permite imprimir por puerto serie. Usa Chrome o Edge.");
    const port = await serial.requestPort();
    await port.open({ baudRate: 9600 });
    const w = port.writable.getWriter();
    await w.write(bytes);
    w.releaseLock();
    await port.close().catch(() => undefined);
    return;
  }
  throw new Error("Esta impresora no se puede usar desde el navegador.");
}
