/* =====================================================================
   从军 · 成分分析 —— 评价体系（独立口径文件，2026-11-10 从主页拆出）

   ★ 这个文件只管「怎么算分、怎么判级、怎么贴标签」，不碰 DOM、不碰接口、
     不碰录像二进制解析。要改口径，改这里；主页（成分分析.html）只负责
     取数据、渲染、拼文案，不再重写一套公式。

   ── 评分总公式 ───────────────────────────────────────────────
     枪法分   = (场均击杀 ÷ 标准1 的 120.74) × 100            ← K/D 不进枪法
     额外加分 = 六项超出的部分，权重 4:2:1:1:1:1，每份 0.6 分，封顶 +6
                （修造复活点 : 反击载具 : 占领点 : 点内击杀 : K/D : 击杀数量）
     环境修正 = 填线（战神 +2~6.5 / 宝宝 −1.2~4）
                + 少打多（+1~5）+ 队内相对（±2）
     总分     = max(0, 枪法分 + 额外加分 + 环境修正) × (1 + 录像净修正)
     录像净修正 = 负向🐵 扣 5%~10% − 正向 加 5%~15%，夹在 [−10%, +15%]

   ── 判级 ─────────────────────────────────────────────────────
     6.2 及格线 = 120 分（标准1 本人加完抗压 ×1.2 之后的量）
       >120 → 「6.2+ 超出刻度」      >138（+15%）→ 「6.2+ 数据有疑问」
     12 级分带 [10,23,32,39,46,53,61,69,78,87,120]（末位抬到 120）
     over / suspect 只看 枪法分 + 额外加分（core），环境修正与录像修正都不参与。
     标准1 本人（BENCH.uid）总分钉死 120，录像修正对他不生效。

   ── 关键口径（踩过坑的都在这） ───────────────────────────────
     K/D      = kills ÷ deaths（阵亡人数），标准1 = 12074÷3217 = 3.75
     冲点强度 = squadDeaths（被打掉的班数），标准1 场均 4.86 班
     人机局   = 双方真人 <5（2026-11-10 从 7 调下来）逐场降权：3~4 人 ×0.4，≤2 人 ×0.2
                场均击杀只算满编局（≥5 真人）；全场真人只有他自己的单人局整场剔除
     装甲运兵车 ≠ 载具，是「另类复活点」（录像里单列 spawn 线）
     录像结论与战绩结论相似度 <70% → 录像修正不进总分（applied=false）
     刷人机嫌疑 = 近期活跃（≥10 场、最近一场 ≤30 天）+ 回放库有效录像 ≤4 场
                  → 分数后挂「⚠ 刷人机来的」，同句列出录像无效原因，不动分数

   ── 用法 ─────────────────────────────────────────────────────
     网页：<script src="评价体系.js"></script>（放在主脚本之前）
           主脚本里 const { BENCH, gradeOf, bonusOf, ... } = CJEval;
     Node：const CJEval = require("./评价体系.js");
           CJEval.gradeOf(统计对象, { avgK }, 场次, 逃跑率, null, { uid, name })
           直接算，不需要浏览器环境（stats 字段见 gradeOf / fillOf / vehMonkeyOf 的入参）。
     自查：CJEval.summary() 返回一份口径摘要（纯文本），方便脚本/AI 读。

   注：T.f1 / T.f2 / T.rpClock 是本文件内部的格式化工具（四舍五入 / 分秒），
       网页里可用 CJEval.use({ f1, f2, rpClock }) 注入主脚本的实现，保持显示一致。
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CJEval = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* 格式化工具：默认实现与主脚本完全一致；可在网页里用 use() 换成主脚本的版本 */
  const T = {
    f1: v => Math.round(v * 10) / 10,
    f2: v => Math.round(v * 100) / 100,
    rpClock: sec => {
      sec = Math.max(0, Math.round(sec || 0));
      return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
    }
  };



/* ------------------------------------------------------------------
   占点 / 少打多 口径常量
   ------------------------------------------------------------------ */
/* 占点评价（2026-11-09，用户口径 v3）
   用户原话：「基本上 3 以上的占点就基本上打满全场了，也要跟队友去比，
   比如我方最高占点 5，你 1，那就拉完了，如果是 3 那就是跟着打满了全场。」

   为什么不能只看绝对次数：一局 3~5 个点，占 3 次在 5 点局里只算跟满，在 3 点局里就是满贯；
   反过来队友都在 4~5 次、你 1 次，绝对数看着「有占」，实际是挂名。所以两项都要算：

     绝对达标度 = min(场均占点 ÷ 3, 1)              // 3 次/场 = 打满，5 次/场 = 大满贯
     队友相对度 = min((场均占点 ÷ 队友当场最高占点) ÷ 0.6, 1)   // 到队友的 6 成才算跟满
     满贯度     = min(max(场均占点 − 3, 0) ÷ 2, 1)  // 3 次以上到 5 次，多占一次多一分
     占点分（0~100） = 50 × 绝对达标度 + 40 × 队友相对度 + 10 × 满贯度

   判级另外加两道「相对闸门」：队友明显比你占得多，就不许给「扛旗 / 主力」这两个词；
   只到队友四分之一以下（队友 5、我 1）直接判「拉完了」——这一条是用户原话。

   分母只放「有点可占」的局（capMode.open）：整队 0 占点（denied）和无占点模式（none）都不进，
   否则被推平的几场会把他判成「不站旗」——这正是用户 2026-11-09 定的那一条。 */
const CAP_E = {
  full: 3,        // 3 次/场 = 打满全场（用户给的锚点）
  grand: 4.2,     // ≈5 次/场 = 大满贯（3 点局占满 + 换点/回防）
  relFull: 0.6,   // 占到自己队友当场最高的 6 成 = 跟满（队友 5、我 3）
  relZero: 0.25,  // 不到队友最高的四分之一 = 拉完了（队友 5、我 1）
  minN: 3         // 有点局少于 3 场不给分
};
/* 少打多的门槛（2026-11-08）
   gap    ：对面名单比我们多几个真人，才算「少打多」（2 = 至少多两个）
   mine   ：人少的一边，本人击杀要达到我方人均的几倍，才算这局打得出来
   minHit / minRate：至少命中几场、命中率多少，才给这笔加分（样本太小容易碰运气）
   min / max：加分区间 1 ~ 5 分 */
const OUT_W = { gap: 2, mine: 1.25, minHit: 3, minRate: 35, min: 1.0, max: 5.0 };
/* 抗压大师（2026-11-08）：少打多的「场次」多到一定程度，给称号，并把枪法权重放大 20%。
   为什么给权重而不是单列一笔：他的击杀是在人数吃亏的局里打出来的，同样 60 杀含金量更高，
   所以放大的是「枪法」本身（进 core，参与判级），不是环境补偿（那两笔不参与判级）。
     minHit  ：少打多局里真正打得出来的场次（绝对量，"场次多"就是这一条）
     minRate ：这些场次占他全部少打多局的比例（防止样本极大时几场也算"多"）
     minGap  ：对面平均得多出几个真人（设 1 = 不额外卡人数差 —— 少打多本身每场对面就至少多 2 人）
     mul     ：枪法权重倍数，1.2 = 提高 20%
   注意：标准1 本人也是抗压大师，所以 6.2 的及格线 = 100 × mul = 120 分（见 OVER_SCORE）。 */
const OUT_M = { minHit: 8, minRate: 45, minGap: 1, mul: 1.2 };


/* ------------------------------------------------------------------
   评分公式 / 分带 / 标准1 标尺
   ------------------------------------------------------------------ */
/* ---------------- 评价生成 ---------------- */
function tier(v, table, def){
  for (const t of table){ if (v >= t[0]) return t[1]; }
  return def || table[table.length - 1][1];
}
/* 基础分：沿用原来五项加权（满分 100），保证老结论大体可比 */
function scoreBase(o){
  const kb = 1 + Math.max(0, Math.min(0.18, o.killBoost || 0));  // 击杀领先加成，只作用于击杀项
  const a = Math.min(o.winRate / 95, 1) * 34;   // 胜率
  const b = Math.min(o.avgWK / 150, 1) * 24 * kb; // 场均击杀（载具已按战功折算，不再单列加分）
  const c = Math.min(o.kd / (BENCH.kd * 1.07), 1) * 18;  // K/D（人数口径，基准 3.75）
  const d = Math.min(o.capAvg / 2.5, 1) * 12;   // 场均占点
  const e = Math.min(o.top1Rate / 60, 1) * 12;  // 全场第一率
  return a + b + c + d + e;
}

/* 修正分：把战绩接口里剩下的字段全部折算成加减项 */
function scoreAdjust(o, fleeRate){
  const items = [];
  const add = (k, v, note) => items.push({ k: k, v: v, note: note });

  // 1 争夺参与：点内击杀占比（进攻 + 防守）
  add("点内击杀", o.pinRate >= 35 ? 4 : o.pinRate >= 25 ? 2 : o.pinRate >= 15 ? 0 : -5, T.f1(o.pinRate) + "%");
  // 2 生存：每战斗分钟被打掉的班数（冲点频率，阈值按标准1 的 dpm 相对定：0.775 / 0.93 / 1.085 倍）
  add("生存", o.dpm <= BENCH.dpm * 0.775 ? 3 : o.dpm <= BENCH.dpm * 0.93 ? 1.5 : o.dpm <= BENCH.dpm * 1.085 ? 0 : -3, T.f2(o.dpm) + " 班/分");
  // 3 纪律：逃跑 / 早退比例
  add("纪律", fleeRate <= 0.5 ? 3 : fleeRate <= 2 ? 1 : fleeRate <= 5 ? -1 : -4, T.f1(fleeRate) + "% 逃跑");
  // 4 开团：一血
  add("开团", o.fbPer >= 0.25 ? 1.5 : o.fbPer >= 0.1 ? 0.5 : -0.5, T.f2(o.fbPer) + " 一血/场");
  // 5 支援：工程设施使用 + 助攻率
  add("支援", (o.engPer >= 6 || o.asstRate >= 10) ? 1.5 : (o.engPer >= 3 || o.asstRate >= 7) ? 0.5 : 0,
      T.f1(o.engPer) + " 次工程/场 · 助攻 " + T.f1(o.asstRate) + "%");
  // 6 反甲：打掉敌方载具按坦克5/飞机3/运兵车3折算，占战功比例越高越是真干活
  add("反甲", o.vehRate >= 20 ? 3 : o.vehRate >= 10 ? 2 : o.vehRate >= 4 ? 1 : 0, T.f1(o.vehRate) + "% 战功");

  return { items: items, total: items.reduce((s, x) => s + x.v, 0) };
}

function clamp100(v){ return Math.max(0, Math.min(100, v)); }

function scoreDetail(o, fleeRate){
  const base = scoreBase(o);
  const adj = scoreAdjust(o, fleeRate || 0);
  // 修正只做微调：上限 +6，避免强号直接顶到 100；下限 -12，逃跑多的真该扣
  const capped = Math.max(-12, Math.min(6, adj.total));
  const raw = base + capped;
  return { base: base, adj: capped, adjRaw: adj.total, items: adj.items, raw: raw, total: clamp100(raw) };
}

function score100(o, fleeRate){
  return scoreDetail(o, fleeRate).total;
}

/* 风格指纹：不适合进分数的字段，转成打法标签 */
function styleProfile(s){
  const vehR = s.vehRate;            // 载具折算战功占击杀比例
  const want = [];
  if (s.pinRate >= 38) want.push(["点内绞肉机", "hi"]);
  else if (s.pinRate >= 28) want.push(["以点为主", "hi"]);
  else if (s.pinRate >= 18) want.push(["点内外兼顾", ""]);
  else if (s.avgK >= 60) want.push(["点外收割", "bad"]);
  else want.push(["点内参与少", "bad"]);
  if (s.pin > 150){
    if (s.pinD > s.pinA * 1.5) want.push(["守点型", ""]);
    else if (s.pinA > s.pinD * 2) want.push(["攻点型", "hi"]);
    else want.push(["攻守均衡", ""]);
  }
  if (vehR >= 20) want.push(["反甲主力", "hi"]);
  else if (vehR >= 10) want.push(["会打装甲", "hi"]);
  else if (vehR >= 4) want.push(["顺手炸车", ""]);
  else want.push(["纯步兵位", ""]);
  if (s.meleeRate >= 1.2) want.push(["贴脸狂", "hi"]);
  if (s.nadeRate >= 2.4) want.push(s.vehPer >= 0.3 ? ["炸药包反甲", "hi"] : ["手雷党", ""]);
  if (s.pistolRate >= 0.8) want.push(["手枪侠", ""]);
  if (s.fbPer >= 0.22) want.push(["开团先锋", "hi"]);
  else if (s.fbPer <= 0.06) want.push(["不打第一枪", ""]);
  if (s.fortPer >= 4) want.push(["修碉堡的", ""]);
  else if (s.engPer >= 6) want.push(["工兵", ""]);
  /* 死亡频率：以标准1 的每分被击杀数为刻度（×1.085 = 拿命换头，×0.795 = 惜命），
     口径是 squadDeaths（班数），所以阈值跟着 BENCH.dpm 走，不再写死绝对值。 */
  if (s.dpm >= BENCH.dpm * 1.085) want.push(["拿命换头", "bad"]);
  else if (s.dpm <= BENCH.dpm * 0.795) want.push(["惜命", "hi"]);
  if (s.spm >= 450) want.push(["高产出", "hi"]);
  else if (s.spm <= 300) want.push(["磨洋工", "bad"]);
  /* 被打掉的班数（squadDeaths）和「被击杀次数」现在是同一个字段，
     再按 sqdPer 判一次会和上面的 dpm 标签重复，所以这里不再单独出标签。 */
  if (s.asstRate >= 12) want.push(["爱补刀", "hi"]);
  else if (s.asstRate >= 8) want.push(["会配合", ""]);
  if (s.hsRate >= 13) want.push(["枪法硬", "hi"]);
  else if (s.hsRate < 8) want.push(["乱扫", "bad"]);
  return want.map(x => ({ t: x[0], tone: x[1] }));
}

/* ---------------- 玩家分级（12 级，6 大档 × 2 小档） ----------------
   判定不是单纯拿总分卡线：六个维度各自归一化后加权，再看纪律扣分。
   维度：枪法(场均击杀+K/D)、胜率、意识(点内击杀占比)、支援(工程+助攻)、反甲(载具战功占比)、经验(生涯场次) */
const GRADES = [
  { no:"1.1", name:"纯萌新", band:"萌新",
    trait:"占点、建复活点、看标记这些还不做，见人先开枪再瞄准，经常被 AI 反杀。",
    ev:"还没入门。动作没成型，枪口比眼睛快，死了也不知道自己死在谁手上。",
    vs:"跟谁比都不占优，先别谈换算。",
    need:"三件事：会敲复活点、会敲弹药箱、跟着人往点上走。" },
  { no:"1.2", name:"入门萌新", band:"萌新",
    trait:"知道要占点、会跟队，偶尔敲个弹药箱；路线走得直，枪法随缘，击杀靠对面失误。",
    ev:"入门了，但只有概念没有执行。知道该干嘛，一到开打就全忘。",
    vs:"打一个合格兵要两个以上，还得有人带着。",
    need:"把路线走歪一点，别每次都从正门进；枪口先稳住，再谈爆头。" },
  { no:"2.1", name:"基础新手", band:"新手",
    trait:"机制懂了，弹药箱和复活点会敲，点也知道占；位置感差，经常死在半路上。",
    ev:"会做事，但站的地方不对。死在路上的次数，比死在点里的多。",
    vs:"打老兵要 3 个以上，打路人王基本没戏。",
    need:"先学会「不白给」：进点前找掩体、别横穿大马路、别一个人摸侧翼。" },
  { no:"2.2", name:"进阶新手", band:"新手",
    trait:"会看标记、跟队补位，枪法开始有感觉，能辅助队友，偶尔打出像样的击杀。",
    ev:"该会的都会了，缺的是稳定。偶尔像个人，多数时候还是跟不上节奏。",
    vs:"打老兵要 2–3 个；打路人王 3 个起。",
    need:"把「偶尔」变成「每场」：固定两三条进攻路线，练熟一套枪。" },
  { no:"3.1", name:"合格兵", band:"普通水平",
    trait:"会修点、占点、换弹找掩体，1v1 看运气，能完成基本任务。",
    ev:"对局中坚，稳定执行任务。单兵上限不高，遇到老兵基本被压。",
    vs:"打老兵要 2–3 个；打路人王要 3–4 个。",
    need:"补单兵上限：1v1 别慌、关键点敢站、先学会「换掉一个再死」。" },
  { no:"3.2", name:"熟练普通", band:"普通水平",
    trait:"懂常见路线，枪法凑合，偶尔小连杀，但遇到老登一碰就碎。",
    ev:"基本功扎实，只差经验和细节。比合格兵强，但仍不能单独改变战局。",
    vs:"打老兵要 2 个；打路人王要 3 个。",
    need:"从「完成任务」往「打开局面」走：学会读局势、主动开团、抓对面复活点。" },
  { no:"4.1", name:"老兵", band:"老兵",
    trait:"理解更深，会绕侧、拆复活点、反载具；单兵仍逊老登，但能制造麻烦。",
    ev:"经验丰富，战术意识在线，能打开局面。单挑老登吃亏，但能让老登难受。",
    vs:"打路人王要 2 个；打老登要 3 个。",
    need:"把「能制造麻烦」变成「能决定结果」：稳定 carry 一小片战场。" },
  { no:"4.2", name:"精锐老兵", band:"老兵",
    trait:"能稳定给老登压力，关键点能拖能守，偶尔反杀，知道何时送、何时撤、何时绕。",
    ev:"攻守兼备，节奏感强，普通玩家里面的标杆。距路人王只差稳定 carry 和全局影响力。",
    vs:"打路人王 1–2 个，2 个稳；打老登 2–3 个，3 个稳。",
    need:"差的是全局：别只盯着自己那条线，学会看全图节奏和小队调度。" },
  { no:"5.1", name:"路人王", band:"路人王",
    trait:"单排常居前列，能左右局部战局，关键点能打开，能带起一小片节奏。",
    ev:"单排大腿，局部战场的定心丸。队友跟着有底气，但未必能一人逆转整局。",
    vs:"1v1 打老登大概三七开，单挑明显吃亏；2 个路人王无配合也能胜 1 个老登——老登再强也只能同时盯一个方向。3 个基本碾压，但没必要。",
    need:"补逆风能力：局面崩了之后，还能不能找出第二条路。" },
  { no:"5.2", name:"顶级路人王", band:"路人王",
    trait:"能左右整局，杀关键人、建关键点、开载具/反载具，逆风也能找机会。",
    ev:"关键先生，胜负手级别。逆风能带队找希望，但面对车队老登仍可能被体系压制。",
    vs:"1v1 对老登已经五五开，单挑不虚；2 个顶级路人王基本稳赢 1 个老登；1 个打老登看状态、装备和地图，不算稳，但有机会。",
    need:"到这一步已经不是单兵问题了，缺的是能配合你的第二个、第三个人。" },
  { no:"6.1", name:"老登", band:"老登",
    trait:"综合成型，枪法、意识、工程、载具至少多项强，知道怎么赢，稳定压制。",
    ev:"六边形战士，战场定海神针。不一定杀最多，但最知道怎么让对手赢不了。",
    vs:"打同档基本看谁的队友先崩；对下位基本是稳定压制。",
    need:"没什么可补的，保持就行——真要挑，就是别被版本和装备惯坏。" },
  { no:"6.2", name:"老老登", band:"老登",
    trait:"全维度压制：单兵、战术、载具、车队、心理战都强，能让你输得不明不白。",
    ev:"天花板级别的传奇。技术、意识与心态俱佳，是无数玩家追赶的目标，也是噩梦。",
    vs:"遇到这种号，别想着单挑，先想办法别让他在关键点站住。",
    need:"已经不是「练」能追上的层次，遇到就当上课。" }
];
/* 分级带：索引 i 的等级覆盖 [BANDS[i-1], BANDS[i])，最后一档为满分。
   标定依据：用 12 组建档基准画像（每档各一组典型数值）反推，保证一档一组、不扎堆。
   **只把 6.2 那条线抬到 120**（= 标准1 加完抗压权重后的分），下面 11 档一个没动：
   100 分（= 标准1 的原始枪法）现在落在 6.1，要 120 分才够 6.2。 */
const GRADE_BANDS = [10, 23, 32, 39, 46, 53, 61, 69, 78, 87, 120];

/* 每一档两套开场/收尾，按玩家名做确定性抽签：同一个人每次看都一样，不同人读起来不一样 */
const GRADE_OPEN = [
  ["还在打基础的阶段，先别急着上强度。", "这号现在最缺的不是技术，是习惯。"],
  ["知道该干嘛了，但一到开打就全忘。", "入门是入门了，执行还差得远。"],
  ["会做事，但站的地方不对。", "机制明白了，脑子还没跟上手。"],
  ["该会的都会，缺的是稳定。", "手感有了，稳定性没跟上。"],
  ["能干活，但改变不了战局。", "任务能完成，上限看得见。"],
  ["基本功扎实，只差那口气。", "比合格兵强一档，但还不能单独改命。"],
  ["经验在线，能打开局面。", "会绕、会拆、会反载具，是老练的那种。"],
  ["攻守兼备，节奏感是这号最大的本钱。", "普通玩家里的标杆，就差全局那一步。"],
  ["自己那一片，基本是他的地盘。", "队友看到这号会踏实一点。"],
  ["基本上是一个人扛半边天。", "逆风局里，他就是那个还愿意找机会的人。"],
  ["不用介绍，这号在局里就是压制力。", "六边形成型，赢法比杀法多。"],
  ["这种号遇到就当上课。", "全维度压制，输得不明不白是常态。"]
];
const GRADE_FINAL = [
  ["现在最该练的不是枪，是别一个人往点里冲。", "先把复活点和弹药箱练成条件反射，其他都是后话。"],
  ["路线别再走直线了，绕一次就少死一次。", "把「知道该干嘛」变成「不用想就干了」，就能往上走一档。"],
  ["死得少一点，比杀得多一点更容易升级。", "位置感是这号唯一的短板，补上就是另一档的人。"],
  ["稳定下来就是合格兵，稳定不了就永远停在「偶尔像个人」。", "把一条路线、一把枪练到闭眼都会，比什么都管用。"],
  ["单兵上限不补，永远只能当对局中坚。", "想往上走，先学会 1v1 不慌、关键点敢站。"],
  ["差的是「打开局面」这四个字，练不出来就卡在这。", "会完成任务不算本事，能改结果才算。"],
  ["能制造麻烦的人很多，能决定结果的少，往后者走。", "把局部优势变成全图优势，就是下一档。"],
  ["再稳一点，你就不是「普通玩家标杆」，是他那一队的核心。", "全局观是最后一道坎。"],
  ["一个人强不叫赢，找到第二个人才叫。", "逆风能不能翻，是这一档和上一档的分水岭。"],
  ["单兵到顶了，接下来拼的是队伍。", "别老想着 1v1，能带人赢才是真的。"],
  ["没什么好挑的，别被版本惯坏。", "保持就好，别为了数据把自己打散。"],
  ["遇到这号，先想办法别让他在关键点站住。", "没什么可建议的，练到这份上已经是别人的目标。"]
];

const c01 = v => Math.max(0, Math.min(1, isFinite(v) ? v : 0));

/* ================= 评分标尺（写死的基准战绩 = 标准1） =================
   「标准1」= 6.2 的刻度线：他这 100 场样本的枪法就是 1.0，原始折 100 分。
   但他本人是抗压大师，枪法权重 ×1.2 → 他的实际得分是 120 分，**120 分才是 6.2 的及格线**。
   别人的总分 = 枪法比 × 100 + 额外加分（4:2:1:1:1:1，只算超出他的部分）+ 环境修正。
   越过 120 分 = 比标准1还强 → 记「6.2+」（不是天花板，刻度外还有一格）。
   越过 15%（>138 分）→ 数据有疑问（疑似开挂）。
   分带只把 6.2 这条线抬到 120（GRADE_BANDS 末位），所以拿满 100 分只到 6.1。
   数据来源：hisBattles 取样 100 场（2026-11-08 抓取，写死在页面里，不查接口也显示、也参与算分）。
   以后要换标尺：改这个对象 + BASE_SCORE，枪法函数和分带都不用动。 */
const BENCH = {
  uid: 2341138, name: "标准1", sample: 100, battles: 428, takenAt: "2026-11-08",
  /* 两套死亡口径（2026-11-09 用户定，各管一件事）：
     ① K/D、场均阵亡 → deaths（阵亡人数）：100 场 3217 人 → 场均 32.17，12074 ÷ 3217 = 3.75；
     ② 冲点强度 → squadDeaths（被打掉的班数）：100 场 486 个班 → 场均 4.86 = 冲点死了多少队。
     dpm 按班算：486 ÷ 1246.9 分钟 ≈ 0.39 班/分。 */
  winRate: 93.0, kd: 3.75, avgK: 120.74, avgD: 32.17, avgDSq: 4.86,
  kills: 12074, deaths: 3217, deathsSq: 486,
  pinRate: 25.73, engPer: 4.61, asstRate: 6.97, vehRate: 5.39, vehPer: 1.52,
  score: 6525, scoreMax: 14343, top1Rate: 72, hsRate: 13.79,
  fbPer: 0.25, dpm: 0.39, spm: 523, sqdPer: 4.86, capAvg: 1.81,
  grade: "6.2 老老登", base: 100
};
const BASE_SCORE = BENCH.base;   // 标准1 的原始枪法刻度 = 100 分（他加完抗压权重后是 120 分 = 6.2 及格线）

/* 班 ↔ 人 的换算系数（标准1：1 个班被打掉 ≈ 6.62 个兵阵亡 = 3217 人 ÷ 486 班）。
   两个字段接口里都有，统计直接各取各的；只有某个字段缺失时才用它回推。 */
const D_SCALE = 486 / 3217;      // ≈ 0.151 = 班 ÷ 人；反过来 人 ÷ 班 ≈ 6.62

/* 单场权重：双方真人总数 < 5 的人机局按比例降权，避免刷人机把数据抬上去
   （2026-11-10 用户口径：满编门槛从 7 人降到 5 人）
   ≥5 人 = 满权；3~4 人 = 0.4；≤2 人 = 0.2；没取到阵容的场次按 1.0（不猜）
   另外「全场只有他自己一个真人」的局更狠：不进统计，整场剔除（见 buildVerdict 的 solo 过滤） */
const W_FULL = 1.0, W_MID = 0.4, W_LOW = 0.2;
function wOfHumans(h){
  if (h == null) return W_FULL;
  if (h >= 5) return W_FULL;
  if (h >= 3) return W_MID;
  return W_LOW;
}

/* 额外加分项：比例 4:2:1:1:1:1，只对「超出的部分」给分，所以标准1本人恒 0 加分
   每份 0.6 分 → 封顶 +6 分 */
const BONUS_PER = 0.6, BONUS_CAP = 6;
const BONUS_ITEMS = [
  { k: "修造复活点", w: 4, get: s => s.engPer, ref: BENCH.engPer, unit: "次/场", d: 1 },
  { k: "反击载具", w: 2, get: s => s.vehPer, ref: BENCH.vehPer, unit: "台/场", d: 2 },
  { k: "占领点", w: 1, get: s => s.capAvg, ref: BENCH.capAvg, unit: "次/场", d: 2 },
  { k: "点内击杀", w: 1, get: s => s.pinRate, ref: BENCH.pinRate, unit: "%", d: 1 },
  { k: "K/D", w: 1, get: s => s.kd, ref: BENCH.kd, unit: "", d: 2 },
  { k: "击杀数量", w: 1, get: s => s.avgK, ref: BENCH.avgK, unit: "杀/场", d: 1 }
];
function bonusOf(s){
  let total = 0;
  /* 🐵 完了：K/D 那一项不计分 —— 这个比值是铁壳替他数的，不是走位。
     只有这一项被关掉，其余五项和枪法分照旧，所以判级刻度不会被动到。 */
  const vm = !!(s && s.vehMonkey && s.vehMonkey.hit);
  const list = BONUS_ITEMS.map(b => {
    const v = b.get(s) || 0;
    const over = b.ref > 0 ? Math.max(0, v / b.ref - 1) : 0;
    const off = vm && b.k === "K/D";
    const pts = off ? 0 : over * b.w * BONUS_PER;
    total += pts;
    return { k: b.k, v: v, ref: b.ref, over: over, w: b.w, pts: pts, unit: b.unit, d: b.d, off: off };
  });
  return { total: Math.min(BONUS_CAP, total), list: list, vehOff: vm };
}

/* 判级刻度（比标准1强不再直接算挂，分两层）：
   raw > 120        → 6.2+（比标准1强，刻度外第一格，真人能打出来）
   raw > 138（+15%）→ 数据有疑问（超出一成半，采样噪声解释不了）

   及格线 = 标准1 本人**加完抗压权重**后的分：标准1 就是抗压大师，枪法权重 ×1.2，
   100 × 1.2 = 120 分。所以 6.2 的含义是「人头到标准1 的量、场面也吃得住」，
   单拿 100 分（等于标准1 的原始枪法）只到 6.1。 */
const OVER_SCORE = BASE_SCORE * OUT_M.mul;        // 120 分：标准1 本人（含抗压 ×1.2）
const SUSPECT_RATE = 1.15;                        // 超出 15% 就上「数据有疑问」
const SUSPECT_SCORE = OVER_SCORE * SUSPECT_RATE;  // 138 分

const OVER_G = {
  no: "6.2+", name: "超出刻度", band: "超出刻度",
  trait: "各项都顶在标准1之上，尤其是枪法这一截——真人有这个上限。",
  ev: "越过标准1的号：不是挂，是标准1已经不够量他了。",
  vs: "已经比标尺还高，往上没有可比的人，只能看他跟标准1差多少。",
  need: "这种号不用练什么了，缺的是对手——别被版本和车队惯坏就行。"
};
const SUSPECT_G = {
  no: "6.2+", name: "数据有疑问", band: "数据有疑问",
  trait: "总分比标准1高出 15% 以上，这个幅度不是采样噪声能解释的。",
  ev: "越过标准1一成半：要么样本有问题（人机局/代打/车队刷），要么数据不干净。",
  vs: "标尺已经压不住了，只能存疑：先别当实力看。",
  need: "没什么可建议的，先自查数据来源；正常打的话换个取样区间再看一次。"
};



/* ------------------------------------------------------------------
   填线 / 🐵 完了 / 枪法 / 判级 / 措辞抽签
   ------------------------------------------------------------------ */
/* ---------------- 填线（2026-11-08，用户口径；2026-11-09 换口径） ----------------
   「填线」是往战线上填人：正面顶、拿命换位置。
   光看 K/D 会把这种人看扁 —— 死得多被当成菜，其实是他在最前面。
   所以分两种：

   ① 填线战神：杀得多、死得也多，K/D 被死亡拖到很低。
      三条同时成立：场均击杀 ≥ 标准1 的 45%（≈54）、场均被打掉 ≥ 标准1 的 115%（≈5.6 个班）、K/D ≤ 标准1 的 45%（≈1.69）。
      这种人正面交换比是划算的（每场几十条人命换出来的人头），评分上单给一笔「填线加成」+2 ~ +6.5 分。
   ② 填线宝宝：杀得少、死得还多，K/D 不到 0.9（死的比杀的还多）。
      场均击杀 ≤ 标准1 的 35%（≈42）、K/D ≤ 0.9、场均被打掉 ≥ 3.6 个班。
      不是「敢冲」，是冲上去没换成 —— 称号照给，总分倒扣 1.2 ~ 4 分。

   口径（2026-11-09 用户定）：**K/D 用阵亡人数**（kills ÷ deaths），
   **「死得多」这件事看被打掉的班数**（squadDeaths）——冲点死了多少队，
   这才是填线的衡量标准：一个人头没换成、还搭进一队人，比单纯 K/D 低更说明问题。
   两点约束：样本 <8 场不判（噪声太大）；加成/扣分直接进总分，不改枪法比，
   所以「枪法 100% = 标准1」这条刻度不会被填线搅乱。 */
const FILL = {
  godK: BENCH.avgK * 0.45,      // ≈54.3 杀/场
  godD: BENCH.avgDSq * 1.15,    // ≈5.6 个班/场（冲点一局搭进去 5.6 队）
  godKd: BENCH.kd * 0.45,       // ≈1.69（人数口径 K/D）
  babyK: BENCH.avgK * 0.35,     // ≈42.3 杀/场
  babyKd: 0.9,                  // 死多于杀（人数口径 K/D）
  babyD: BENCH.avgDSq * 0.75,   // ≈3.6 个班/场
  godMin: 2.0, godMax: 6.5,     // 战神加分区间
  babyMin: 1.2, babyMax: 4.0,   // 宝宝扣分区间（正数存，用的时候取负）
  minN: 8
};
function fillOf(s){
  const n = (s && s.n) || 0, K = (s && s.avgK) || 0;
  const D = (s && s.avgDSq) || 0;                 // 冲点死了多少个班
  const kd = (s && s.kd) || 0;                    // 人数口径 K/D
  const out = { kind: "", K: K, D: D, kd: kd, adj: 0, power: 0, why: "" };
  if (n < FILL.minN){ out.why = "样本不足"; return out; }
  if (K <= 0 && D <= 0){ out.why = "无数据"; return out; }

  /* 战神：三条门槛必须先全过，再按「杀得多 / 死得多 / KD 低」三个方向算强度 */
  if (K >= FILL.godK && D >= FILL.godD && kd <= FILL.godKd){
    const kS = c01((K - FILL.godK) / Math.max(1, BENCH.avgK - FILL.godK));   // 54→0，120→1
    const dS = c01((D - FILL.godD) / Math.max(1, BENCH.avgDSq * 1.5));        // 5.6→0，7.3→1
    const rS = c01((FILL.godKd - kd) / FILL.godKd);                          // 1.69→0，0→1
    out.power = 0.45 * kS + 0.30 * dS + 0.25 * rS;
    out.kind = "god";
    out.adj = FILL.godMin + (FILL.godMax - FILL.godMin) * out.power;
    return out;
  }
  /* 宝宝：杀得少 + 死多于杀 + 死的队数够看 */
  if (K <= FILL.babyK && kd <= FILL.babyKd && D >= FILL.babyD){
    const weak = c01((FILL.babyK - K) / Math.max(1, FILL.babyK));            // 42→0，0→1
    const deep = c01((FILL.babyKd - kd) / FILL.babyKd);                      // 0.9→0，0→1
    out.power = 0.55 * weak + 0.45 * deep;
    out.kind = "baby";
    out.adj = -(FILL.babyMin + (FILL.babyMax - FILL.babyMin) * out.power);
    return out;
  }
  return out;
}

/* ---------------- 🐵 完了（2026-11-09，用户口径） ----------------
   用户原话：高 K/D、低击杀、占点低，一般情况下就是玩载具了，这种直接判定为 🐵 完了。
   后续补充（同一天）：**K/D 只有 3 点多、阵亡人数只有标准的一半，也是明显的 🐵 完了**。

   为什么只能这么判：战绩接口**没有**「坐在载具上杀了多少人」这个字段。
   `tankKills / aircraftKills / apcKills` 是「击毁的敌方载具数」（反甲战果），
   跟「开着坦克杀步兵」是两件事，拿它判🐵 完了会判反。所以只能从间接信号反推。

   第三条补充口径（2026-11-09 第二次）：**跟队友比**也算 ——
     「K/D 高、对比队友战绩排前面的几个，击杀低、小队死亡数低、占点还低」照样直接判 🐵 完了。
     这条路不跟标准1 比（他的绝对值可能都在及格线上），只跟他同场的真人队友比，
     所以能抓住那些「绝对数不差、但一队里就他产出最低」的号。

   三条路，命中一条就算（判据不同、结论一样，判定顺序 A → B → C）：

   【A 显性高 K/D】三条同时成立
     ① K/D ≥ 标准1 的 2 倍（≈7.5）：人在铁壳里，炮打不穿、步兵摸不到，几乎不死。
     ② 场均击杀 ≤ 标准1 的 55%（≈66.4）：炮装填慢、能打的目标就那么多。
     ③ 不在点上：占旗 ≤ 标准1 的六成（≈1.09 次/场）**或** 点内击杀 ≤ 六成（≈15.4%）。

   【B 隐性低阵亡】——K/D 是**比值**，车上杀得少、死得也少，比值会落回基准附近（3.x「看着还行」），
     光看 K/D 会漏掉这种人。所以直接看绝对死亡量：
     ① 场均阵亡 ≤ 标准1 的 65%（≈20.9 人/场）：步兵交火线上的号不可能这么干净。
     ② 场均击杀 ≤ 标准1 的 70%（≈84.5）：人也杀得不多，不是那种「又要人头又不死」的神仙。
     ③ 占旗 或 点内击杀至少有一项没到标准的九成（≈1.63 次/场 / 23.1%）：他不用去争夺点。

   【C 队内视角】五条同时成立（用 battleDetail 名单里的真人队友比）
     ① K/D ≥ 4.9（标准1 的 1.3 倍）且是队友平均 K/D 的 1.4 倍（比值比全队都漂亮）
     ② 场均击杀 ≤ 队友均值的 85%（人头比队友少）
     ③ 被打掉的班数 ≤ 队友均值的 75%（没在正面换命）
     ④ 占点 ≤ 队友当场最高的 50%（旗子靠队友站）
     队内得分名次（平均在前一半 = rankPct ≥ 0.5）只用来加判定强度，不作硬门槛 ——
     击杀、班数都低的人本来分数就高不了，硬卡「排前面」会把该抓的全漏掉；
     真正说明问题的是「K/D 比全队漂亮，但产出样样最少」。

   命中后果只有一条、且是硬的：
   **额外加分里的「K/D」那一项不计分**（K/D 是铁皮替他数的，不是他走位好），
   其余加分项、枪法分、分带一概不动；正文档口「惜命」要改掉（死得少不是会算复活点，是没下车）。
   样本 <8 场不判；判了填线战神/宝宝的不判（那两条看的就是敢死/敢送，和蹲车是反的）。 */
const VEH_M = {
  /* A：显性高 K/D */
  kd: BENCH.kd * 2,          // ≈7.5：标准1 的两倍，步兵很难这么干净
  k: BENCH.avgK * 0.55,      // ≈66.4 杀/场：人头总量上不去
  cap: BENCH.capAvg * 0.6,   // ≈1.09 次/场：旗子基本不站
  pin: BENCH.pinRate * 0.6,  // ≈15.4%：人不在争夺点里
  /* B：隐性低阵亡（K/D 可能只有 3 点多，光看比值看不出来） */
  d: BENCH.avgD * 0.65,      // ≈20.9 人/场：阵亡只有标准的六成五
  k2: BENCH.avgK * 0.70,     // ≈84.5 杀/场
  cap2: BENCH.capAvg * 0.9,  // ≈1.63 次/场
  pin2: BENCH.pinRate * 0.9, // ≈23.1%
  /* C：队内视角（2026-11-09 用户口径）——
     「K/D 高、对比队友战绩排前面的几个，击杀低、小队死亡数低、占点还低」→ 一样判 🐵 完了。
     这条路不设绝对门槛：一队里排前面但杀人、抗线、站旗三项都不如队友，就是没在正面。 */
  kdC: BENCH.kd * 1.3,       // ≈4.9：比值照样好看，不用等到 7.5 才认
  kdRatioC: 1.4,             // K/D 是队友平均的 1.4 倍以上（「比值比全队都漂亮」）
  kRatio: 0.85,              // 击杀不到队友均值的 85%
  sqRatio: 0.75,             // 被打掉的班不到队友的 75%（没在正面换命）
  relC: 0.5,                 // 占点不到队友当场最高的一半
  rankC: 0.5,                // 队内得分平均排前一半（rankPct 1 = 队内第一，0 = 垫底）
  minN: 8
};
function vehMonkeyOf(s){
  const n = (s && s.n) || 0, K = (s && s.avgK) || 0, kd = (s && s.kd) || 0;
  const D = (s && s.avgD) || 0;            // 阵亡人数/场（K/D 的分母）
  const DSq = (s && s.avgDSq) || 0;        // 冲点被打掉的班数/场
  const cap = (s && s.capAvg) || 0, pin = (s && s.pinRate) || 0;
  const out = { hit: false, path: "", K: K, D: D, DSq: DSq, kd: kd, cap: cap, pin: pin, power: 0, why: "" };
  if (n < VEH_M.minN){ out.why = "样本不足"; return out; }
  if (!(K > 0) || !(kd > 0)){ out.why = "无数据"; return out; }
  if (s && s.fill && s.fill.kind){ out.why = "已判填线"; return out; }

  /* A：高 K/D + 低击杀 + 不占点 */
  if (kd >= VEH_M.kd && K <= VEH_M.k && (cap <= VEH_M.cap || pin <= VEH_M.pin)){
    const kdS = c01((kd - VEH_M.kd) / Math.max(1, BENCH.kd * 6));          // 7.5→0，22.5→1
    const kS = c01((VEH_M.k - K) / Math.max(1, VEH_M.k));                  // 66→0，0→1
    const pS = Math.max(c01(1 - cap / Math.max(0.01, VEH_M.cap)), c01(1 - pin / Math.max(0.01, VEH_M.pin)));
    out.hit = true; out.path = "kd";
    out.power = 0.40 * kdS + 0.35 * kS + 0.25 * pS;
    out.why = "高 K/D（" + T.f2(kd) + "）+ 低击杀（" + T.f1(K) + "）+ 不占点（占旗 "
      + T.f2(cap) + "/场、点内 " + T.f1(pin) + "%）";
    return out;
  }

  /* B：死得远少于标准 + 击杀也不多 + 不用去争夺点（K/D 可能只是「看着还行」） */
  if (D > 0 && D <= VEH_M.d && K <= VEH_M.k2 && (cap <= VEH_M.cap2 || pin <= VEH_M.pin2)){
    const dS = c01((VEH_M.d - D) / Math.max(0.01, VEH_M.d));               // 20.9→0，0→1
    const kS = c01((VEH_M.k2 - K) / Math.max(1, VEH_M.k2));                // 84→0，0→1
    const pS = Math.max(c01(1 - cap / Math.max(0.01, VEH_M.cap2)), c01(1 - pin / Math.max(0.01, VEH_M.pin2)));
    out.hit = true; out.path = "lowd";
    out.power = 0.45 * dS + 0.35 * kS + 0.20 * pS;
    out.why = "低阵亡（" + T.f1(D) + " 人/场，标准1 " + T.f1(BENCH.avgD) + "）+ 低击杀（" + T.f1(K)
      + "）+ 不占点（占旗 " + T.f2(cap) + "/场、点内 " + T.f1(pin) + "%）";
    return out;
  }

  /* C：队内视角（2026-11-09 用户口径）—— 不跟标准1 比，跟他这一场的队友比。
     ① K/D ≥ 4.9 且是队友平均的 1.4 倍（比值比全队都好看，名次因此排前面）
     ② 击杀不到队友均值的 85%
     ③ 被打掉的班不到队友的 75%（没在正面换命）
     ④ 占点不到队友当场最高的一半（旗子基本靠队友站）
     队内得分名次只进 intensity（rS），不作硬门槛：击杀和班数都低的人分数本来就上不去。 */
  const MC = s && s.mateCmp;
  if (MC && MC.n >= VEH_M.minN && kd >= VEH_M.kdC
      && kd >= (MC.mateKd || 0) * VEH_M.kdRatioC
      && MC.kRatio <= VEH_M.kRatio && MC.sqRatio <= VEH_M.sqRatio){
    const rel = (s.capEval && s.capEval.relN >= CAP_E.minN) ? s.capEval.rel : (MC.capRel || 0);
    if (rel <= VEH_M.relC){
      const rS = c01(((MC.rankPct || 0) - 0.25) / 0.60);                    // 前排 1，中游 0
      const kS = c01((VEH_M.kRatio - MC.kRatio) / VEH_M.kRatio);            // 85%→0，0→1
      const dS = c01((VEH_M.sqRatio - MC.sqRatio) / VEH_M.sqRatio);         // 75%→0，0→1
      const pS = c01((VEH_M.relC - rel) / VEH_M.relC);                      // 一半→0，0→1
      out.hit = true; out.path = "mate";
      out.power = 0.30 * rS + 0.30 * kS + 0.20 * dS + 0.20 * pS;
      out.why = "队内对比：K/D " + T.f2(kd) + "（队友平均 " + T.f2(MC.mateKd) + "）、击杀 "
        + T.f1(MC.kAvg) + " 少于队友 " + T.f1(MC.mateK) + "、被打掉 " + T.f1(MC.sqAvg) + " 班少于队友 "
        + T.f1(MC.mateSq) + " 班、占点只有队友最高的 " + Math.round(rel * 100) + "%";
      return out;
    }
  }
  return out;
}

/* 基础分只有一个维度：枪法 = 场均击杀 ÷ 标准1 的 120.74（K/D 不进基础分，挪到加分项里单算）
   枪法比 1.0 = 标准1 的原始枪法 = 100 分；他加完抗压权重是 120 分 = 6.2 的及格线
   枪法比会被两项放大：击杀领先 +0~18%、抗压大师 ×1.2（都只放大人头这一项）
   总分 = 枪法分（可超 120）+ 额外加分（封顶 +6）+ 环境修正（填线 ±、少打多 +，封顶 +11.5）
   >120 → 6.2+；>138（超出 15%）→ 数据有疑问（只看枪法 + 加分，环境修正不参与判级） */
function gunOf(s, B){
  return (B.avgK || 0) / BENCH.avgK;
}
function gradeOf(s, B, ovBattles, fleeRate, env, who){
  /* 击杀领先加成：同场击杀比下一位甩得越开，枪法权重越高（上限 +18%）。
     只放大枪法这一项，加分项照旧，所以不会把「靠修点刷分」的号抬起来。 */
  const boost = Math.max(0, Math.min(0.18, s.killBoost || 0));
  const gun0 = gunOf(s, B);
  /* 标准1 本人 = 标尺本身（= 赵云那个号）。
     称号照给、大字照挂 —— 他就是靠这一笔把及格线抬到 120 分的，藏起来反而说不清口径。
     只做两件事保证刻度不抖：总分钉死在 OVER_SCORE（120），击杀领先那笔对他不叠（否则 120 之上还会飘）。 */
  const selfBench = !!who && (String(who.uid) === String(BENCH.uid) || who.name === BENCH.name);
  /* 抗压大师：少打多场次够多 → 枪法权重 ×1.2（只放大人头这一项，加分项照旧）。
     这一笔进 core，所以**参与** 6.2+ / 存疑判定 —— 它改的是枪法本身，不是环境补偿。 */
  const OT = s.outnumbered || null;
  const stressMul = (OT && OT.master) ? OUT_M.mul : 1;
  const gunLead = gun0 * (1 + (selfBench ? 0 : boost));
  const gun = gunLead * stressMul;
  const bn = bonusOf(s);
  /* 环境修正两项：填线（杀得多死得多 / 杀得少死得多）+ 少打多（人少还打得出来）。
     都是「把数据放回环境里看」的补偿，**进总分、能推等级档，但不参与 over / suspect 判定** ——
     「越过及格线」由标准1（赵云）守门：枪法（含抗压倍数）+ 加分 过 120 才算比他强。 */
  const FL = s.fill || fillOf(s);
  const stressGain = (gun - gunLead) * BASE_SCORE;
  const core = gun * BASE_SCORE + bn.total;                 // 判级口径：枪法（含抗压 ×1.2）+ 加分
  /* 队内相对修正（2026-11-09 用户口径）：所有战绩都要放回队友里看，单人绝对值不作数。
     队内指数 idx 就是「五项正向产出的平均队内名次百分位」，中位 = 0 分，
     队内第一 +2、垫底 −2。幅度刻意压小：它只调环境，不改枪法、不参与 over / suspect 判定。 */
  const MR = s.mateRank || null;
  const mateAdj = (MR && MR.n >= 8) ? (MR.adj || 0) : 0;
  const envAdj = (FL.adj || 0) + ((OT && OT.adj) || 0) + mateAdj;   // 填线 + 少打多 + 队内相对
  /* 录像标签修正（2026-11-10 晚定稿）：挂在「环境修正」层，和填线 / 少打多 / 队内相对并列。
     只乘在总分上，不进 core（因此不影响 over / 数据有疑问判定），标准1 本人钉死 120 不参与。
     负向🐵按标签次数扣 5%~10%，正向按次数加 5%~15%，净额由 replayModOf 算好。 */
  const RM = s.replayMod || null;
  const replayRaw = selfBench ? OVER_SCORE : Math.max(0, core + envAdj);
  const replayRate = (!selfBench && RM && RM.ok && RM.applied !== false) ? RM.rate : 0;
  const raw = selfBench ? OVER_SCORE : Math.max(0, replayRaw * (1 + replayRate));
  const over = !selfBench && core > OVER_SCORE + 0.0001;     // 比标准1强 → 6.2+
  const suspect = !selfBench && core > SUSPECT_SCORE + 1e-9; // 超出 15% → 数据有疑问
  const v = Math.max(0, Math.min(OVER_SCORE, raw));
  let idx = GRADE_BANDS.findIndex(b => v < b);
  if (idx < 0) idx = GRADES.length - 1;
  const g = suspect ? SUSPECT_G : over ? OVER_G : GRADES[idx];
  const nextBand = idx < GRADE_BANDS.length ? GRADE_BANDS[idx] : null;
  return {
    v: v, raw: raw, core: core, gun: gun, gun0: gun0, gunLead: gunLead,
    boost: boost, stressMul: stressMul, stressGain: stressGain,
    bonus: bn.list, bonusSum: bn.total,
    fill: FL, fillAdj: FL.adj || 0,
    outnumbered: OT, outAdj: (OT && OT.adj) || 0, envAdj: envAdj,
    mateRank: MR, mateAdj: mateAdj,
    replayRate: replayRate, replayRaw: replayRaw, replayMod: RM,
    idx: idx, g: g, selfBench: selfBench, over: over, suspect: suspect,
    gap: nextBand ? Math.max(0, nextBand - v) : 0
  };
}

/* 同一个玩家刷新多少次都说一样的话；不同玩家措辞不同 */
function picker(seed){
  let t = 2166136261;
  for (let i = 0; i < String(seed).length; i++){ t ^= String(seed).charCodeAt(i); t = Math.imul(t, 16777619); }
  t >>>= 0;
  return arr => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return arr[((x ^ (x >>> 14)) >>> 0) % arr.length];
  };
}


/* ------------------------------------------------------------------
   战绩↔录像 相似度门
   ------------------------------------------------------------------ */
/* ---------------- 战绩判定 × 录像判定 相似度（2026-11-10 深夜） ----------------
   用户口径：两边结论冲突（比如战绩判定不是载具猴、录像判定是）→ 录像结论不采用到
   总体评价上，只在录像佐证那里写「近期如何如何，录像分析可供参考」；
   相似度比较高（≥70%）才用到总体评级上。
   可比维度取两边都有话可说的三项：载具成分、形态方向、点内参与；
   狙击 / 迫击炮 / AA 这些战绩侧没有对应判定的标签，不进相似度（也谈不上冲突）。 */
function rpSimilarityOf(V){
  const s = (V && V.s) || {}, tags = (V && V.tags) || [];
  const R = (V && V.replay) || null;
  const FR = s.replayFront, RF = s.replayFlavor;
  if(!R || !R.ok || (!RF && !FR)) return null;      // 没有录像数据 → 不设门
  const vm = s.vehMonkey || {}, fl = s.fill || {};
  const has = t => tags.some(x => x.t === t);
  const dims = [];
  /* ① 载具成分：战绩「🐵 完了」（硬判 / 没判）↔ 录像载具线标签（硬 / 倾向 / 无） */
  const rpVehTag = ((RF && RF.ok && RF.tags) || []).find(t => t.key === "veh");
  const recVeh = vm.hit ? "full" : "none";
  const rpVeh = rpVehTag ? rpVehTag.level : "none";
  dims.push({ k:"载具成分",
    a: recVeh === "full" ? "判了「🐵 完了」" : "没判载具成分（K/D 加分照常计）",
    b: rpVeh === "full" ? "硬判 🐵 载具猴" : rpVeh === "lean" ? "判 🐵 载具猴·倾向" : "载具线没到门槛",
    ok: recVeh === rpVeh });
  /* ② 形态方向：战绩填线战神 / 填线宝宝 ↔ 录像战神下凡 / 猛猛填线 */
  if(fl.kind && FR && FR.tag){
    dims.push({ k:"形态方向",
      a: fl.kind === "god" ? "判「填线战神」" : "判「填线宝宝」",
      b: FR.dir === "god" ? "判「⚡ 战神下凡」" : "判「🪖 猛猛填线」",
      ok: (fl.kind === "god" && FR.dir === "god") || (fl.kind === "baby" && FR.dir === "fill") });
  }
  /* ③ 点内参与：战绩「点内参与少 / 点外收割」↔ 录像有点局点内击杀高不高 */
  const recPinLow = has("点内参与少") || has("点外收割");
  if(FR && FR.ok && (recPinLow || FR.pinHigh)){
    dims.push({ k:"点内参与",
      a: recPinLow ? "挂「点内参与少 / 点外收割」" : "没挂点内标签",
      b: FR.pinHigh ? "点内击杀是队友的 " + T.f2(FR.pinRatio) + " 倍" : "点内击杀没过队友",
      ok: recPinLow !== !!FR.pinHigh });
  }
  if(!dims.length) return { rate:100, dims:[], m:0, n:0 };
  const m = dims.filter(x => x.ok).length;
  return { rate: m / dims.length * 100, dims: dims, m: m, n: dims.length };
}


/* ------------------------------------------------------------------
   录像评分标签阈值
   ------------------------------------------------------------------ */
/* ---------------- 录像评分标签阈值（2026-11-10 新口径） ----------------
   用户原话：远距离击杀占比高 → 疑似狙🐵；出狙队 → 铁狙🐵；非载具队伍一直活了
   整局 40%~60% 还没死，工兵班 → 有起 AA 打飞机的嫌疑，其他 → 真能在后面🐵；
   迫击炮出得多或占比长 → 迫击炮🐵。🐵 族负向扣分、正向评价加分，按标签次数改总分。 */
/* ---------------- 刷人机嫌疑（2026-11-10 用户口径） ----------------
   口径：最近战绩打得不少（近期活跃），可回放库里能对上的**有效录像只有 0~4 场**
   → 这些局多半没进正式对局池（人机 / 自定义局），战绩要打折看，卡头分数后面挂提示。
   只有在真做过回放库检测（replay.pool.checked）时才判，纯看战绩不猜。
   「找到 X 场，但没有有效录像」和逐条原因是同一句里的两截，reason 直接给渲染层用。 */
const BOTFARM = { effMax: 4, minN: 10, maxDays: 30 };
const RP_WHY = {
  short:  "时长不到 7 分钟",
  few:    "真人不到 3 个（人机局）",
  nourl:  "没有 .erpl 直链（过期或被清）",
  absent: "名单里没有这个玩家（隐身 / 换昵称）",
  detail: "详情接口取不到",
  other:  "其他原因"
};
function rpWhyText(why){
  const w = why || {};
  return Object.keys(w).filter(k => w[k] > 0)
    .sort((a, b) => w[b] - w[a])
    .map(k => (RP_WHY[k] || RP_WHY.other) + " " + w[k] + " 场")
    .join(" · ");
}
function botFarmOf(s, replay){
  const pool = replay && replay.pool;
  if(!pool || !pool.checked) return null;                 // 没查过回放库 → 不猜
  const effN = (+pool.ok) || 0;
  if(!(+pool.all)) return null;                           // 回放库一场都没搜到 → 是查不到，不是刷
  if(effN > BOTFARM.effMax) return null;                  // 有效录像够多，不判
  const n = (s && s.n) || 0;
  if(n < BOTFARM.minN) return null;                       // 近期场次太少，谈不上「活跃」
  const days = (s && s.lastDays != null) ? s.lastDays : null;
  if(days != null && days > BOTFARM.maxDays) return null; // 最近一场太久没打
  return {
    hit: true, effN: effN, all: (+pool.all) || 0, n: n, days: days,
    why: pool.why || {},
    reason: rpWhyText(pool.why)
  };
}

const RP_MOD_MIN = {
  distRate:35,        // 远距离击杀占全部击杀 ≥35% → 疑似狙🐵
  longRatio:0.40,     // 单条非载具出击占全场 ≥40%（40%~60% 是用户给的主区间，更长的照样判）
  mortarN:3,          // 迫击炮出击 ≥3 次
  mortarDepRate:25,   // 或占全部出击 ≥25%
  mortarTimeRate:20,  // 或迫击炮线占可判时长 ≥20%
  mortarSec:180,      // 且 ≥3 分钟
  leanN:2, leanRate:10
};


/* ------------------------------------------------------------------
   录像标签 → 总分修正
   ------------------------------------------------------------------ */
/* ---------------- 录像评分标签：铁狙🐵 / 疑似狙🐵 / AA 嫌疑 / 后方🐵 / 迫击炮🐵 ----------------
   side: neg = 🐵族负向，pos = 正向评价；weight: 硬档 1、倾向档 0.5；n = 命中场次数（上限 3）。
   同一 key 在 replayModOf 里只取最高的一次，避免「狙猴 + 铁狙🐵」把同一个🐵扣两遍。 */
function replayStamps(R, F, env){
  const tags = [], lines = [];
  if(!R || !R.ok || !F || !F.ok) return { ok:false, tags:tags, lines:lines, distNote:"" };
  const add = (key, side, weight, n, label, why) => tags.push({
    key:key, side:side, weight:weight, n:Math.max(1, Math.min(3, n || 1)),
    level:weight < 1 ? "lean" : "full", label:label, tone:side === "neg" ? "bad" : "hi", why:why });

  /* ① 远距离击杀占比高 → 疑似狙🐵；出狙队 → 铁狙🐵 */
  const dr = F.distRate;
  let distNote = "";
  if(dr != null && dr >= RP_MOD_MIN.distRate){
    add("sniper", "neg", 1, 1, "🎯 疑似狙🐵",
      "远距离击杀占 " + T.f1(dr) + "%（" + F.dist.kills + "/" + F.dist.total + "），过了 "
      + RP_MOD_MIN.distRate + "% 线");
  }else if(dr == null){
    distNote = "远距离击杀数值本次没读到：.erpl 里只有 long_range_kills 这个字段名、值在位打包里解不出，"
      + "战绩接口也没有该字段；「疑似狙🐵」这条独立判据本次不生效，绝不编造这个比例"
      + "（出过狙队的话按「铁狙🐵」判）。";
  }else{
    distNote = "远距离击杀占 " + T.f1(dr) + "%，没到 " + RP_MOD_MIN.distRate + "% 线，不判疑似狙🐵。";
  }
  if(F.sniperDeploy >= 1){
    add("sniper", "neg", 1, F.hit.sniper || F.sniperDeploy, "🎯 铁狙🐵",
      "录像里实打实出过 " + F.sniperDeploy + " 次狙击班（狙击线 " + Math.round(F.sniper / 60)
      + " 分钟 / " + T.f1(F.sniperRate) + "%），出狙队就是铁狙🐵");
    if(dr == null) distNote += " 本次「疑似狙🐵」没有独立的远距数据可判，结论由铁狙🐵承载。";
  }
  /* 注：不再设「疑似狙🐵·倾向」的降级分支 —— 狙击线时长本来就来自狙击班出击，
     不可能出现「有狙击线占比却没出过狙队」，那条分支是死代码，留着会误导。 */

  /* ② 非载具队一直活了整局 40%~60% 还没死，且这场击杀比队内第一低 30%~80%
     （2026-11-10 用户口径补：只有「活得久 + 击杀确实低」才算在后面；自己就是队内第一
      或低超过 80% 的不判。队内第一取 battleDetail 名单层，名单可能只有几个人，
      只能算「名单里的同队第一」。长活段在场没换队但该场击杀不低的，不判。） */
  const recBy = {};
  /* 坑：战绩接口的 sessionId 是大写、录像侧从 url 提取的 sid 是小写，
     匹配必须两边都转小写，否则击杀门永远查不到战绩。 */
  ((env && env.recs) || []).forEach(x => { if(x && x.sid) recBy[String(x.sid).toLowerCase()] = x; });
  const noRec = [];   // 长活段对应场次没有战绩记录可比的，如实说明
  const gapOf = x => {
    const rec = recBy[String(x.sid || "").toLowerCase()];
    if(!rec){ noRec.push(x); return null; }
    const top = Math.max(+rec.myK || 0, +rec.mK || 0);
    if(!(top > 0)) return null;
    return { gap: 1 - (+rec.myK || 0) / top, myK: +rec.myK || 0, top: top };
  };
  const AA = (F.longLived || []).filter(x => x.engineer);   // AA 嫌疑不卡击杀门（工兵班架炮本来就低杀）
  const BK = [], BKg = [];
  (F.longLived || []).filter(x => !x.engineer).forEach(x => {
    const g = gapOf(x);
    if(g && g.gap >= 0.30 && g.gap <= 0.80){ BK.push(x); BKg.push(g); }
  });
  const whyLong = (arr, gaps) => arr.slice(0, 3).map((x, i) => "〔" + x.map + "〕" + x.unit + " 从 "
    + T.rpClock(x.t) + " 起活了 " + T.f1(x.ratio) + "% 全场（" + Math.round(x.dur) + " 秒）没换队"
    + (gaps && gaps[i] ? "，该场 " + gaps[i].myK + " 杀对队内第一 " + gaps[i].top
      + " 杀（低 " + T.f1(gaps[i].gap * 100) + "%）" : "")).join("；")
    + (arr.length > 3 ? " 等 " + arr.length + " 条" : "");
  if(AA.length) add("aa", "neg", 1, F.hit.longAA || AA.length, "⚠ 起AA打飞机的嫌疑",
    whyLong(AA) + " —— 工兵班能这么久不倒，多半是在后场架 AA 打飞机，不是在前线顶");
  if(BK.length) add("back", "neg", 1, BK.length, "🐵 真能在后面🐵",
    whyLong(BK, BKg) + " —— 活得久 + 击杀比队内第一低 30%~80%，人基本不在正面交火线上");

  /* ③ 迫击炮出得多 / 占比长 */
  const mN = R.mortar || 0, mDep = R.totalDeploy ? mN / R.totalDeploy * 100 : 0;
  const mSec = (F.detail && F.detail.mortar) || 0, mRate = F.mortarRate || 0;
  const mHard = mN >= RP_MOD_MIN.mortarN || mDep >= RP_MOD_MIN.mortarDepRate
    || (mRate >= RP_MOD_MIN.mortarTimeRate && mSec >= RP_MOD_MIN.mortarSec);
  const mLean = !mHard && (mN >= RP_MOD_MIN.leanN || mRate >= RP_MOD_MIN.leanRate);
  if(mHard || mLean) add("mortar", "neg", mHard ? 1 : 0.5, mHard ? (F.hit.mortar || 1) : 1,
    mHard ? "💣 迫击炮🐵" : "💣 迫击炮🐵·倾向",
    "迫击炮出 " + mN + " 次（占全部出击 " + T.f1(mDep) + "%）、在场 " + Math.round(mSec / 60)
    + " 分钟（占可判时长 " + T.f1(mRate) + "%）");

  if(distNote) lines.push(distNote);
  lines.push("长活非载具队判据：单条出击占全场 ≥" + (RP_MOD_MIN.longRatio * 100)
    + "% 且不是载具 / 狙击 / 开局队，**还得这场击杀比队内第一低 30%~80%**（自己就是第一或低超过 80% 的不判）；"
    + "本次长活段命中 " + (F.longLived || []).length
    + " 条（工兵 " + AA.length + " / 其他 " + BK.length + " 条过击杀门"
    + (noRec.length ? "，另有 " + noRec.length + " 条场次没有战绩记录可比、不判" : "") + "）。");
  lines.push("迫击炮判据：出击 ≥" + RP_MOD_MIN.mortarN + " 次或占出击 ≥" + RP_MOD_MIN.mortarDepRate
    + "%，或在场占比 ≥" + RP_MOD_MIN.mortarTimeRate + "% 且 ≥" + RP_MOD_MIN.mortarSec + " 秒；本次 "
    + mN + " 次 / " + T.f1(mDep) + "% 出击 / " + T.f1(mRate) + "% 时长 → "
    + (mHard ? "硬判" : mLean ? "倾向" : "不判") + "。");
  lines.push("新判的录像评分标签共 " + tags.length + " 条" + (tags.length
    ? "：" + tags.map(t => t.label).join("、") : "（本次一条没命中）") + "。");
  return { ok:true, tags:tags, lines:lines, distNote:distNote };
}

/* ---------------- 录像标签 → 总分修正 ----------------
   负向（🐵族）按次数扣 5%~10%，正向按次数加 5%~15%；净额夹在 −10% ~ +15%。
   硬档算 1 次、倾向档 0.5 次，同类标签在多场命中最多累计 3 次，同一 key 不重复计。
   这笔走 gradeOf 的「环境修正」层：进总分、能推档位，不进 core、不动 over / 存疑。 */
function replayModOf(R, F, FR, ST){
  if(!R || !R.ok) return null;
  const all = [];
  const put = (key, side, weight, n, label, why) => all.push({
    key:key, side:side, weight:weight || 1, n:Math.max(1, Math.min(3, n || 1)), label:label, why:why });
  ((F && F.ok) ? F.tags : []).forEach(t => put(t.key, "neg", t.level === "lean" ? 0.5 : 1,
    t.key === "veh" ? F.hit.veh : F.hit.sniper, t.label, t.why));
  if(FR && FR.ok && FR.tag) put("front", FR.dir === "god" ? "pos" : "neg",
    FR.tag.level === "lean" ? 0.5 : 1, FR.n || 1, FR.tag.label, FR.tag.why);
  ((ST && ST.tags) || []).forEach(t => put(t.key, t.side, t.weight, t.n, t.label, t.why));
  const byKey = {};
  all.forEach(x => { const w = x.weight * x.n; if(!byKey[x.key] || w > byKey[x.key].w) byKey[x.key] = { w:w, x:x }; });
  const list = Object.keys(byKey).map(k => byKey[k].x);
  const cnt = side => list.filter(x => x.side === side).reduce((a, x) => a + x.weight * x.n, 0);
  const neg = cnt("neg"), pos = cnt("pos");
  const negRate = neg > 0 ? Math.min(0.10, Math.max(0.05, 0.05 + (neg - 1) * 0.025)) : 0;
  const posRate = pos > 0 ? Math.min(0.15, Math.max(0.05, 0.05 + (pos - 1) * 0.05)) : 0;
  const rate = Math.max(-0.10, Math.min(0.15, posRate - negRate));
  const lines = [];
  lines.push("参与评分的录像标签 " + list.length + " 类：负向 " + T.f1(neg) + " 次 / 正向 " + T.f1(pos)
    + " 次（硬档算 1 次、倾向档 0.5 次，同类最多 3 次，同一类不重复计）。");
  if(list.length) lines.push(list.map(x => "〔" + (x.side === "neg" ? "负" : "正") + "〕"
    + x.label + " ×" + T.f1(x.weight * x.n) + "：" + x.why).join("；"));
  lines.push("负向按次数扣 " + T.f1(negRate * 100) + "%（区间 5%~10%），正向按次数加 "
    + T.f1(posRate * 100) + "%（区间 5%~15%），净修正 " + (rate > 0 ? "+" : "") + T.f1(rate * 100)
    + "%；作用在总分上，不进枪法分、不进 over / 数据有疑问判定、不动六项加分。");
  return { ok:(list.length > 0 && Math.abs(rate) > 1e-9), tags:list, neg:neg, pos:pos,
           negRate:negRate, posRate:posRate, rate:rate, lines:lines };
}

  /* ================= 对外接口 ================= */
  const API = {
    VERSION: "2026-11-10",
    /* 工具注入（可选） */
    use: deps => { Object.assign(T, deps || {}); return API; },
    /* 口径常量 */
    CAP_E: CAP_E, OUT_W: OUT_W, OUT_M: OUT_M,
    BENCH: BENCH, BASE_SCORE: BASE_SCORE, D_SCALE: D_SCALE,
    W_FULL: W_FULL, W_MID: W_MID, W_LOW: W_LOW,
    BONUS_PER: BONUS_PER, BONUS_CAP: BONUS_CAP, BONUS_ITEMS: BONUS_ITEMS,
    OVER_SCORE: OVER_SCORE, SUSPECT_RATE: SUSPECT_RATE, SUSPECT_SCORE: SUSPECT_SCORE,
    FILL: FILL, VEH_M: VEH_M, RP_MOD_MIN: RP_MOD_MIN,
    /* 分带与等级 */
    GRADES: GRADES, GRADE_BANDS: GRADE_BANDS,
    GRADE_OPEN: GRADE_OPEN, GRADE_FINAL: GRADE_FINAL,
    OVER_G: OVER_G, SUSPECT_G: SUSPECT_G,
    /* 评分函数 */
    tier: tier, scoreBase: scoreBase, scoreAdjust: scoreAdjust,
    clamp100: clamp100, scoreDetail: scoreDetail, score100: score100,
    styleProfile: styleProfile, wOfHumans: wOfHumans, c01: c01,
    bonusOf: bonusOf, fillOf: fillOf, vehMonkeyOf: vehMonkeyOf,
    gunOf: gunOf, gradeOf: gradeOf, picker: picker,
    /* 录像侧 */
    rpSimilarityOf: rpSimilarityOf, replayStamps: replayStamps, replayModOf: replayModOf,
    BOTFARM: BOTFARM, RP_WHY: RP_WHY, rpWhyText: rpWhyText, botFarmOf: botFarmOf,
    /* 口径摘要（给脚本 / AI 读） */
    summary: function () {
      const b = BENCH;
      return [
        "从军·评价体系 v" + API.VERSION,
        "标尺：标准1（UID " + b.uid + "）取样 " + b.sample + " 场；枪法 1.0 = " + T.f1(b.avgK) + " 杀/场 = " + T.f1(BASE_SCORE) + " 分；"
          + "标准1 抗压 ×" + OUT_M.mul + " → 及格线 " + T.f1(OVER_SCORE) + " 分 = 6.2",
        "K/D 口径：kills ÷ deaths，标准1 " + T.f2(b.kd) + "；冲点强度用 squadDeaths，标准1 " + T.f1(b.avgDSq) + " 班/场",
        "总分 = (枪法分 + 六项加分(封顶 +" + BONUS_CAP + ") + 环境修正) × (1 + 录像净修正[" + "-10%,+15%]" + ")",
        "判级：>" + T.f1(OVER_SCORE) + " → 6.2+ 超出刻度；>" + T.f1(SUSPECT_SCORE) + "（+" + Math.round((SUSPECT_RATE - 1) * 100) + "%）→ 数据有疑问",
        "分带：" + GRADE_BANDS.join(" / "),
        "人机口径：双方真人 <5 判人机局（≥5 满权 / 3~4 ×0.4 / ≤2 ×0.2）；场均击杀只算满编局；"
          + "全场真人只有他自己的单人局整场剔除（逃跑 / 早退不重复剔）",
        "录像门：与战绩判定相似度 <70% 时录像修正不进总分；标准1 本人钉死 " + T.f1(OVER_SCORE) + " 分",
        "刷人机嫌疑：近期 ≥" + BOTFARM.minN + " 场（最近一场 ≤" + BOTFARM.maxDays + " 天）但回放库有效录像 ≤"
          + BOTFARM.effMax + " 场 → 分数后挂「刷人机来的」，并列出录像无效原因"
      ].join("\n");
    }
  };
  return API;
});
