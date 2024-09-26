import WCFService from './wcf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


// console.log({ demoXML })
const wcfServer = new WCFService();
await wcfServer.init();
const roomId = "43360512573@chatroom"
const filehelper = "filehelper"
const demoXML = fs.readFileSync(path.join(__dirname, "demo.xml")).toString()
wcfServer.sendAlternativeXML(demoXML, filehelper)
console.log('sendAlternativeXML')
// const res = wcfServer.execSql("MSG0.db", `select * from MSG where type = 49 ORDER BY CreateTime DESC LIMIT 1;`);
// const msg = res[0];
// wcfServer.execSql("MSG0.db", `UPDATE MSG SET CompressContent = x'${msg.CompressContent.toString("hex")}',BytesExtra=x'${msg.BytesExtra.toString("hex")}' WHERE localId = 55;`);
// console.log(msg);
// console.log(msg.CompressContent);
// console.log(msg.CompressContent.toString());
// const res = wcfServer.execSql("MSG0.db", `select * from MSG where type = 49 and IsSender = 0 ORDER BY localId desc LIMIT 1;`)[0]
// console.log(res)
// wcfServer.forwardMsg(res.MsgSvrID, filehelper)
// wcfServer.forwardMsg("8864946020601626971", filehelper)

