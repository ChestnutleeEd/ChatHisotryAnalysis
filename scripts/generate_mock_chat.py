#!/usr/bin/env python3
"""Generate a deterministic, synthetic CipherTalk detailed-json fixture."""

from __future__ import annotations

import argparse
import calendar
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple


CHINA_TZ = timezone(timedelta(hours=8))
OWNER = ("wxid_mock_me", "我")
FRIEND = ("wxid_mock_friend", "小雨")

TYPE_SPECS: Sequence[Tuple[float, str, int, int, str]] = (
    (0.82, "文本消息", 1, 0, ""),
    (0.05, "图片消息", 3, 1, "[图片]"),
    (0.04, "语音消息", 34, 2, "[语音消息]"),
    (0.02, "视频消息", 43, 3, "[视频]"),
    (0.04, "动画表情", 47, 5, "[动画表情]"),
    (0.02, "链接或文件消息", 49, 4, ""),
    (0.01, "系统或通话消息", 50, 6, ""),
)

SHORT_REPLIES = (
    "好呀", "收到", "嗯嗯", "可以", "行", "知道啦", "哈哈哈", "真的嘛", "没问题",
    "等我一下", "马上到", "不急不急", "晚点说", "赞同", "有道理", "确实", "安排",
    "okk", "Good idea", "绝了😂", "好滴～", "在呢", "然后呢", "别忘啦", "嗯……",
)

TOPICS: Sequence[Dict[str, Sequence[str]]] = (
    {
        "openers": ("早呀", "早上好", "醒了吗", "刚起床", "今天起得挺早", "闹钟响了三遍"),
        "subjects": ("早餐", "豆浆", "咖啡", "面包", "鸡蛋", "燕麦", "包子", "通勤"),
        "actions": ("已经准备好了", "记得带上", "还在纠结吃什么", "路上顺便买", "别空腹出门", "今天换个口味"),
        "details": ("地铁可能有点挤", "八点前出门比较稳", "昨晚睡得太晚了", "窗外阳光很好", "先喝杯温水"),
    },
    {
        "openers": ("中午吃什么", "饭点到啦", "突然有点饿", "午休了吗", "我刚点完餐", "厨房开工"),
        "subjects": ("番茄炒蛋", "牛肉面", "沙拉", "饺子", "火锅", "米饭", "烤鱼", "家常菜"),
        "actions": ("想自己做", "看起来很香", "少放一点辣", "给你留一份", "下次一起去吃", "外卖还要二十分钟"),
        "details": ("今天要多吃蔬菜", "冰箱里还有蘑菇", "记得按时吃饭", "那家店评分有4.8", "甜品就先算了"),
    },
    {
        "openers": ("刚开完会", "今天工作好多", "项目有新进展", "学习打卡", "文档终于写完了", "下午要专注一下"),
        "subjects": ("方案", "需求", "代码", "汇报", "课程", "笔记", "考试", "截止日期"),
        "actions": ("还要再检查一遍", "准备拆成几个小任务", "已经同步给同事了", "晚上复习半小时", "需要换个思路", "明天继续处理"),
        "details": ("别把自己逼太紧", "先解决最重要的部分", "休息五分钟再开始", "deadline是周五", "今天效率还不错"),
    },
    {
        "openers": ("我出门啦", "刚到地铁站", "准备下班", "路上注意安全", "公交还有三站", "今天堵车了"),
        "subjects": ("地铁", "公交", "共享单车", "雨伞", "晚高峰", "导航", "车票", "充电宝"),
        "actions": ("比预计快一点", "可能要晚到十分钟", "已经放进包里了", "到家给我发消息", "换条路试试", "先找个地方等"),
        "details": ("外面开始下小雨", "风比早上大", "气温降到18度了", "路口正在施工", "耳机只剩20%电"),
    },
    {
        "openers": ("周末去哪儿", "想出去走走", "假期计划一下", "车票可以订了", "看了几个攻略", "突然想看海"),
        "subjects": ("杭州", "苏州", "成都", "青岛", "博物馆", "古镇", "露营", "民宿"),
        "actions": ("先收藏起来", "两天一夜刚刚好", "提前预约比较保险", "想拍很多照片", "路线不要排太满", "预算控制在1200以内"),
        "details": ("天气合适就出发", "带双舒服的鞋", "周六早班车便宜", "我负责做行程表", "留半天随便逛逛"),
    },
    {
        "openers": ("晚上看点什么", "最近歌单更新了", "游戏要不要开一局", "那部电影上线了", "耳机里正在循环", "推荐你一个节目"),
        "subjects": ("悬疑片", "纪录片", "喜剧", "独立音乐", "播客", "桌游", "Switch", "演唱会"),
        "actions": ("口碑好像不错", "一起看更有意思", "已经听了三遍", "周末可以试试", "别给我剧透", "先下载到平板"),
        "details": ("片长是128分钟", "主角演得很自然", "这段旋律特别治愈", "链接是https://example.com/mock", "今晚十点开始"),
    },
    {
        "openers": ("今天运动了吗", "我去跑步了", "准备拉伸", "昨晚睡得好吗", "困得睁不开眼", "健康打卡"),
        "subjects": ("跑步", "瑜伽", "羽毛球", "游泳", "散步", "睡眠", "颈椎", "步数"),
        "actions": ("坚持了三十分钟", "别忘了热身", "今天先轻松一点", "争取早点睡", "已经完成8000步", "需要慢慢恢复"),
        "details": ("十一点前放下手机", "运动完心情很好", "明早肌肉可能会酸", "水杯记得装满", "连续坐太久要起来活动"),
    },
    {
        "openers": ("周末安排一下", "明天有空吗", "想约你出来", "日历上先记一下", "别忘了我们的约定", "我来确认时间"),
        "subjects": ("书店", "公园", "咖啡馆", "菜市场", "展览", "生日蛋糕", "牙医", "体检"),
        "actions": ("下午两点见", "我提前十分钟到", "需要带身份证", "已经预约成功", "到时候再选地点", "改到周日也可以"),
        "details": ("集合点在南门", "记得设个提醒", "票放在手机里", "如果下雨就换室内", "结束后一起吃晚饭"),
    },
    {
        "openers": ("今天是个好日子", "节日快乐呀", "生日愿望想好了吗", "终于放假了", "新的一月开始", "给你准备了小惊喜"),
        "subjects": ("春节", "元宵", "清明", "端午", "中秋", "国庆", "生日", "纪念日"),
        "actions": ("想和你一起庆祝", "给家里打个电话", "礼物要晚点揭晓", "今年简单过也很好", "准备吃顿好吃的", "照片记得备份"),
        "details": ("愿你每天都开心", "月亮今晚很圆", "假期别熬夜", "红包只是小心意", "下一年也请多关照"),
    },
    {
        "openers": ("刚才我语气有点重", "这件事我想再说清楚", "我不是故意不回消息", "我们先别着急", "我认真想了一下", "不想带着情绪睡觉"),
        "subjects": ("误会", "迟到", "计划变化", "消息回复", "分工", "边界", "耐心", "心情"),
        "actions": ("对不起让你担心了", "下次会提前告诉你", "我们慢慢聊清楚", "我也应该听完你的想法", "可以重新商量", "现在已经好多了"),
        "details": ("我在乎你的感受", "谢谢你愿意解释", "不是谁输谁赢的问题", "抱抱，翻篇吧", "晚安之前和好"),
    },
    {
        "openers": ("今天天气变化好快", "窗外雾蒙蒙的", "太阳终于出来了", "预报说明天降温", "雷声有点大", "空气很清新"),
        "subjects": ("晴天", "阵雨", "台风", "温度", "湿度", "晚霞", "云朵", "季节"),
        "actions": ("记得多穿一件", "出门带伞", "适合晒被子", "晚点可能放晴", "想去楼下走走", "拍下来发给你"),
        "details": ("最高温度27度", "路面有点滑", "秋天的风很舒服", "紫外线指数偏高", "天气App又猜错了"),
    },
)

STOP_WORD_HEAVY = (
    "那个，就是，然后我觉得这个事情还是可以再看一下的。",
    "嗯，所以呢，其实也没有什么，就是先这样吧。",
    "然后然后，我就是想说，你知道的，那个也还好。",
    "这个那个都可以，因为我们还是要看看是不是这样。",
)


def _allocate_type_counts(count: int) -> List[int]:
    raw = [count * spec[0] for spec in TYPE_SPECS]
    allocated = [int(value) for value in raw]
    remainder = count - sum(allocated)
    order = sorted(range(len(raw)), key=lambda i: (raw[i] - allocated[i], -i), reverse=True)
    for index in order[:remainder]:
        allocated[index] += 1
    return allocated


def _conversation_timestamps(count: int, year: int, rng: random.Random) -> List[int]:
    start = datetime(year, 1, 1, 7, 12, 0, tzinfo=CHINA_TZ)
    end = datetime(year, 12, 31, 23, 46, 0, tzinfo=CHINA_TZ)
    if count == 1:
        return [int(start.timestamp())]

    days_in_year = 366 if calendar.isleap(year) else 365
    day_weights: List[float] = []
    for day_index in range(days_in_year):
        weekday = (datetime(year, 1, 1) + timedelta(days=day_index)).weekday()
        roll = rng.random()
        if roll < 0.16:
            weight = 0.0
        elif roll > 0.93:
            weight = rng.uniform(4.5, 7.5)
        else:
            weight = rng.uniform(0.55, 1.65)
        if weekday >= 5:
            weight *= 1.18
        day_weights.append(weight)
    day_weights[0] = max(day_weights[0], 1.0)
    day_weights[-1] = max(day_weights[-1], 1.0)

    timestamps = [int(start.timestamp()), int(end.timestamp())]
    for _ in range(count - 2):
        day_index = rng.choices(range(days_in_year), weights=day_weights, k=1)[0]
        window_roll = rng.random()
        if window_roll < 0.26:
            seconds = rng.randint(7 * 3600, 8 * 3600 + 59 * 60 + 59)
        elif window_roll < 0.49:
            seconds = rng.randint(12 * 3600, 13 * 3600 + 59 * 60 + 59)
        elif window_roll < 0.91:
            seconds = rng.randint(18 * 3600, 23 * 3600 + 59 * 60 + 59)
        elif window_roll < 0.95:
            seconds = rng.randint(0, 30 * 60)
        else:
            seconds = rng.randint(9 * 3600, 17 * 3600 + 59 * 60 + 59)
        moment = datetime(year, 1, 1, tzinfo=CHINA_TZ) + timedelta(
            days=day_index, seconds=seconds
        )
        timestamps.append(int(moment.timestamp()))
    timestamps.sort()
    return timestamps


def _speaker_sequence(count: int, rng: random.Random) -> List[int]:
    owner_count = round(count * 0.48)
    flags = [1] * owner_count + [0] * (count - owner_count)
    rng.shuffle(flags)
    return flags


def _text_message(index: int, is_send: int, rng: random.Random) -> str:
    if index % 97 == 0:
        return rng.choice(STOP_WORD_HEAVY)
    if rng.random() < 0.18:
        return rng.choice(SHORT_REPLIES)

    topic = rng.choice(TOPICS)
    opener = rng.choice(topic["openers"])
    subject = rng.choice(topic["subjects"])
    action = rng.choice(topic["actions"])
    detail = rng.choice(topic["details"])
    suffix = rng.choice(("。", "！", "～", "呀", "哈哈", "🙂", "😂", "，你觉得呢？"))

    patterns = (
        f"{opener}，{subject}{action}{suffix}",
        f"{subject}{action}，{detail}{suffix}",
        f"{opener}。{detail}，{subject}{action}{suffix}",
        f"{opener}，关于{subject}我想了想，{action}{suffix}",
        f"{detail}，所以{subject}{action}{suffix}",
    )
    text = rng.choice(patterns)
    if rng.random() < 0.055:
        extra_topic = rng.choice(TOPICS)
        text += (
            f" 另外，{rng.choice(extra_topic['subjects'])}"
            f"{rng.choice(extra_topic['actions'])}，"
            f"{rng.choice(extra_topic['details'])}。"
        )
    if is_send:
        text += rng.choice(("", "", " 我先去忙会儿。", " ok？", " 晚点同步你。"))
    else:
        text += rng.choice(("", "", " 你别太累啦。", " 到了告诉我哦。", " 我等你～"))
    return text


def _non_text_payload(
    local_type: int,
    default_content: str,
    index: int,
    earlier_ids: Sequence[str],
    rng: random.Random,
) -> Tuple[str, Any, str, Dict[str, Any]]:
    optional: Dict[str, Any] = {}
    if local_type == 3:
        raw = f"<img md5=\"mock{index:08x}\" width=\"{rng.randint(720, 1440)}\" />"
        return "图片消息", default_content, raw, optional
    if local_type == 34:
        seconds = rng.randint(1, 46)
        return "语音消息", default_content, f"<voicemsg voicelength=\"{seconds * 1000}\" />", optional
    if local_type == 43:
        seconds = rng.randint(3, 75)
        return "视频消息", default_content, f"<videomsg playlength=\"{seconds}\" />", optional
    if local_type == 47:
        return "动画表情", default_content, f"<emoji md5=\"mockemoji{index:06d}\" />", optional
    if local_type == 49:
        kind = rng.choice(("link", "file", "reply", "reply"))
        if kind == "link":
            title = rng.choice(("旅行清单", "本周影单", "食谱收藏", "天气提醒"))
            content = f"[链接] {title}"
            raw = json.dumps(
                {"appmsg": {"type": 5, "title": title, "url": "https://example.com/mock"}},
                ensure_ascii=False,
                separators=(",", ":"),
            )
            return "链接消息", content, raw, optional
        if kind == "file":
            filename = f"mock_plan_{index:04d}.pdf"
            return "文件消息", f"[文件] {filename}", f"<appmsg type=\"6\"><title>{filename}</title></appmsg>", optional
        if earlier_ids:
            reply_id = rng.choice(earlier_ids)
            optional["replyToMessageId"] = reply_id
            content = rng.choice(("这个可以", "我看到了，稍后回复", "就按这个计划吧", "这里需要再确认一下"))
            raw = f"<appmsg type=\"57\"><refermsg><svrid>{reply_id}</svrid></refermsg></appmsg>"
            return "引用消息", content, raw, optional
        return "链接消息", "[链接] 示例页面", '{"appmsg":{"type":5}}', optional

    if rng.random() < 0.52:
        return "通话消息", rng.choice(("[语音通话]", "[视频通话]")), f"<voipmsg duration=\"{rng.randint(8, 1800)}\" />", optional
    return "系统消息", rng.choice(("你撤回了一条消息", "小雨撤回了一条消息", "通话已结束")), "", optional


def generate_dataset(count: int, year: int, seed: int) -> Dict[str, Any]:
    """Return a complete deterministic synthetic export."""
    if count < 1:
        raise ValueError("count must be at least 1")
    if year < 1971 or year > 9998:
        raise ValueError("year must be between 1971 and 9998")

    rng = random.Random(seed)
    timestamps = _conversation_timestamps(count, year, rng)
    type_indexes: List[int] = []
    for type_index, type_count in enumerate(_allocate_type_counts(count)):
        type_indexes.extend([type_index] * type_count)
    rng.shuffle(type_indexes)
    speaker_flags = _speaker_sequence(count, rng)

    messages: List[Dict[str, Any]] = []
    message_ids: List[str] = []
    for offset, (created_at, type_index, is_send) in enumerate(
        zip(timestamps, type_indexes, speaker_flags), start=1
    ):
        _, type_name, local_type, chat_lab_type, default_content = TYPE_SPECS[type_index]
        platform_id = f"mock_{year}_{offset:08d}_{rng.getrandbits(40):010x}"
        sender = OWNER if is_send else FRIEND
        optional: Dict[str, Any] = {}

        if local_type == 1:
            content: Any = _text_message(offset, is_send, rng)
            raw_content = content
        else:
            type_name, content, raw_content, optional = _non_text_payload(
                local_type, default_content, offset, message_ids, rng
            )
            if offset % 211 == 0:
                content = None
            elif offset % 307 == 0:
                content = ""
                raw_content = "<malformed-like payload"

        message: Dict[str, Any] = {
            "localId": offset,
            "platformMessageId": platform_id,
            "createTime": created_at,
            "formattedTime": datetime.fromtimestamp(created_at, CHINA_TZ).strftime(
                "%Y-%m-%d %H:%M:%S"
            ),
            "type": type_name,
            "localType": local_type,
            "chatLabType": chat_lab_type,
            "content": content,
            "rawContent": raw_content,
            "isSend": is_send,
            "senderUsername": sender[0],
            "senderDisplayName": sender[1],
            "source": "",
        }
        message.update(optional)
        messages.append(message)
        message_ids.append(platform_id)

    exported_at = int(datetime(year, 12, 31, 23, 59, 59, tzinfo=CHINA_TZ).timestamp())
    return {
        "exportInfo": {
            "version": "0.0.2",
            "exportedAt": exported_at,
            "generator": "CipherTalk",
            "format": "detailed-json",
        },
        "session": {
            "wxid": FRIEND[0],
            "nickname": FRIEND[1],
            "remark": FRIEND[1],
            "displayName": FRIEND[1],
            "type": "私聊",
            "platform": "wechat",
            "isGroup": False,
            "ownerId": OWNER[0],
            "firstTimestamp": timestamps[0],
            "lastTimestamp": timestamps[-1],
            "messageCount": len(messages),
        },
        "messages": messages,
    }


def write_dataset(output: Path, count: int, year: int, seed: int) -> None:
    dataset = generate_dataset(count=count, year=year, seed=seed)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(dataset, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a deterministic synthetic CipherTalk detailed-json export."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/mock/ciphertalk_detailed_chat_2025.json"),
        help="Output JSON path.",
    )
    parser.add_argument("--count", type=int, default=5000, help="Number of messages.")
    parser.add_argument("--year", type=int, default=2025, help="Calendar year to cover.")
    parser.add_argument("--seed", type=int, default=20250729, help="Random seed.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        write_dataset(args.output, args.count, args.year, args.seed)
    except ValueError as exc:
        raise SystemExit(f"error: {exc}") from exc


if __name__ == "__main__":
    main()
