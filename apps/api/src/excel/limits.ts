/** Un .xlsx de 5 MB en base64 pesa ~6,7 MB: el cuerpo HTTP admite hasta 8 MB (Fastify trae 1 MB por defecto). */
export const ExcelBodyLimit = 8 * 1024 * 1024;
