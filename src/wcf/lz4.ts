
import lz4js from 'lz4js';

export default class WCFLz4 {
  static async unCompress(input_data: Uint8Array) {
    let out_length = input_data.length * 4
    let out_data = Buffer.alloc(out_length)
    lz4js.decompressBlock(input_data, out_data, 0, out_length, 0)

    while (out_length > 0 && out_data[out_length - 1] === 0) {
      out_length--;
    }
    return out_data.subarray(0, out_length)
  }

  static async compress(input_data: Uint8Array) {
    // 初始化 hashTable 的大小
    const hashTableSize = 65536; // 64KB, 根据需要调整
    const hashTable = new Array(hashTableSize).fill(-1);
    const input_length = input_data.length
    let out_data = Buffer.alloc(input_length)
    const out_length = lz4js.compressBlock(input_data, out_data, 0, input_length, hashTable)
    console.log(out_length)
    return out_data.subarray(0, out_length)
    // while (out_length > 0 && out_data[out_length - 1] === 0) {
    //     out_length--;
    // }
    // return out_data.subarray(0, out_length)
  }
}





// Return a new array without trailing nulls

