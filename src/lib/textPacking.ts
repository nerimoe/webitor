// First 1,024 unique characters from the SUBTLEX-CH-CHR frequency ordering.
const FREQUENT_CHARACTERS =
  '我的你是了不们这一他么在有个好来人那要会就什没到说吗为想能上去道她很看可知得过吧还对里以都事子生时样也和下真现做大啊怎出点起天把开让给但谢着只些如家后儿多意别所话小自回然果发见心走定听觉太该当经妈用打地再因呢女告最手前找行快而死先像等被从明中哦情作跟面诉爱' +
  '已之问错孩斯成它感干法电间哪西己候次信欢正实关进车年喜认克爸谁方老应比帮无晚动头机分特相全杀需放常直才美于带今力工许东名同长亲种者嘿白学安尔叫理本国第友高两保请非重公记身受住活加何伙题完接拿望解其离谈又新更钱马思部场嗯计任确吃始结利朋警士外件难位表刚希查拉' +
  '边或将男准变证物员总噢系几管玩处办主气每少切失算性此必备合德队试抱医通体乐并三早门害歉选嗨房命且向兴球服入照提掉夫路演够日案舞决求约字呃肯目笑伤神父指报留水教枪清色号世远片官口师原酒周星识赛救底棒须收交坐停卡尼婚格眼金蛋息室内运根单宝哥张搞战火罗至万声布音' +
  '期条消买病整奇弟犯装贝您送怕护度花节近怪持光与穿愿象影击使二喝月器察制嘛哈助达海待托除写绝界帝姐反担司强由论飞亚续视母空军跑阿尽注弄密线代忙坏久议衣血钟继礼数份疯平止十拜鬼睡啦调巴兄紧站品英罪文亮抓跳联混便狗脑业歌精包转却参院务基台另恩书统风况四黑否险言米' +
  '杰校幸传复量首改忘术局客假永维岁据派票兰恶烦取游糟令随五圣式探嘴毒越律费科麻简易流治唱答倒划控味区漂支乎录考超拍轻连往组满造弹静故吸喂集极讲块趣类呀戏曾容步投化未束醒威班终差梦赢药迪店丽卖显监图半语付热排楚偷敢油餐破莱杯市城哇权某激立程伊讨责昨闭庭落饭林换' +
  '及船争猜洛级姆雷刻建团王惊迎段标检各义百民功唯夜示靠释脸引择疑赶俩独冷妹楼皮存练娘顿断设松博置逃观痛狂足码恐吉历慢妻山普价元角怀床奥模验索街艾呼祝料休灵狱剧乱展板承则顾深产洗政迷领午纳谎具退福习秘奶遇职架即挺史负千脱瑞背仅追伦炸资画踪射弃傻藏屁瞧修尸闻共懂' +
  '蒂危专呆介萨魔急碰甚糕苦念适华冲骗厌型麦似红值脚六谋套凯众预际咱波卫聊养导虑私戴毁鱼滚志杂居词食诺读误撒突牛馆规陪州肉形耶凶森商纪浪石顺举按旅努坚测免喔丝辆乔防句印恋玛弗季严推伯莉武胜毛压败究评屋双牙斗鸡审南速蠢丈守获八致细勒称塔丢冰态吓古亡状鲁疗操遗判响' +
  '网箱货围签牌户寻质供奖袋胡脏堂曼效露替娜座园拥睛冒甜股香笔沙扰挑姑爆镇暴困项概摩虽纽享配迹登诞竟叔捕赌阻彩搬属招婆巧骨塞剩酷啡课烟摄封咖低技迟纸烧委暗左输曲仍训借扔善社轮顶聪秀刀莫腿族鞋兵锁妮异誓树木抢档雇广丹银镜群坦汉土短伴播环恨移编温刺毫右野哭遍库搭康'

const characters = Array.from(FREQUENT_CHARACTERS)
const indexes = new Map(characters.map((character, index) => [character, index]))

export function shouldPackText(text: string) {
  return /[\u3400-\u9fff]/u.test(text)
}

export function packText(text: string) {
  const output: number[] = []
  for (const character of text) {
    const index = indexes.get(character)
    if (index !== undefined) {
      if (index < 224) output.push(index)
      else output.push(224 + ((index - 224) >>> 8), (index - 224) & 0xff)
      continue
    }
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0xff) output.push(240, codePoint)
    else if (codePoint <= 0xffff) output.push(241, codePoint >>> 8, codePoint & 0xff)
    else output.push(242, codePoint >>> 16, (codePoint >>> 8) & 0xff, codePoint & 0xff)
  }
  return Uint8Array.from(output)
}

export function unpackText(bytes: Uint8Array) {
  const output: string[] = []
  let chunk = ''
  const append = (character: string) => {
    chunk += character
    if (chunk.length >= 8192) {
      output.push(chunk)
      chunk = ''
    }
  }
  const take = (index: number) => {
    if (index >= bytes.length) throw new Error('The packed text is truncated')
    return bytes[index]
  }
  for (let offset = 0; offset < bytes.length;) {
    const token = bytes[offset++]
    if (token < 224) {
      append(characters[token])
    } else if (token < 240) {
      const index = 224 + (token - 224) * 256 + take(offset++)
      if (!characters[index]) throw new Error('The packed text contains an invalid character index')
      append(characters[index])
    } else if (token === 240) {
      append(String.fromCodePoint(take(offset++)))
    } else if (token === 241) {
      append(String.fromCodePoint((take(offset++) << 8) | take(offset++)))
    } else if (token === 242) {
      const codePoint = (take(offset++) << 16) | (take(offset++) << 8) | take(offset++)
      if (codePoint > 0x10ffff) throw new Error('The packed text contains an invalid code point')
      append(String.fromCodePoint(codePoint))
    } else {
      throw new Error('The packed text contains an unsupported token')
    }
  }
  output.push(chunk)
  return output.join('')
}
