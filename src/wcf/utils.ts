import path from "path";
import { WCFWxDBFiledType } from "./types";
import fs from 'fs';
import https from 'https';

/**
 * 将Uint8Array转换为字符串
 * @param content 
 * @returns 
 */
export const uint8Array2str = (content: Uint8Array) => {
  return new TextDecoder().decode(content);
}

/**
 * 转换数据库字段
 * @param type 
 * @param content 
 * @returns 
 */
export const parseDBField = (type: WCFWxDBFiledType, content: Uint8Array) => {
  switch (type) {
    case WCFWxDBFiledType.INT: {
      const strContent = uint8Array2str(content);
      const maxSafeNumLength = Number.MAX_SAFE_INTEGER.toString().length;
      if (strContent.length >= maxSafeNumLength) {
        return BigInt(strContent);
      } else {
        return parseInt(strContent);
      }
    }
    case WCFWxDBFiledType.FLOAT: {
      return parseFloat(uint8Array2str(content));
    }
    case WCFWxDBFiledType.BYTES: {
      return Buffer.from(content);
    }
    case WCFWxDBFiledType.NONE: {
      return undefined;
    }
    default:
    case WCFWxDBFiledType.LAMBDA: {
      return uint8Array2str(content);
    }
  }
}

/**
 * 暂停一段时间
 * @param ms 
 * @returns 
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ToLocalFileOptions {
  name: string;
  file: Buffer | string;
  dir?: string;
}
export const toLocalFile = async (options: ToLocalFileOptions) => {
  const { name, file, dir } = options;
  // 判断dir是否存在，不存在则创建
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, {
      recursive: true
    });
  };
  const filePath = path.join(dir || '', name);
  // 按照data的类型写入文件
  if (file instanceof Buffer) {
    fs.writeFileSync(filePath, file);
  } else if (typeof file === 'string') {
    // 判断是否是base64
    const base64Reg = /^data:.*;base64,/;
    if (base64Reg.test(file)) {
      const base64Data = file.replace(base64Reg, '');
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    }
    // 判断是否是路径
    else if (fs.existsSync(file)) {
      fs.copyFileSync(file, filePath);
    }
    // 判断是否是url
    if (/^https?:\/\//.test(file)) {
      await new Promise((resolve, reject) => {
        https.get(file, (res) => {
          const writeStream = fs.createWriteStream(filePath);
          res.pipe(writeStream);
          writeStream.on('close', () => {
            resolve(filePath);
          });
          writeStream.on('error', (err) => {
            reject(err);
          });
        });
      });
    }
  }
  return {
    filePath,
    cleanUp: () => {
      fs.unlinkSync(filePath);
    }
  }
}
