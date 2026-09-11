import datetime
ts_list = {
  "turn1_start(收令)": 1789022617335,
  "派第六棒2491620d": 1789023052369,
  "M2回报turn2": 1789023917954,
  "M3回报turn3": 1789024158515,
  "M4回报turn4": 1789024378949,
  "M5回报turn5": 1789024545133,
  "M6回报turn6": 1789024764669,
  "收官补丁turn7": 1789024820701,
  "turn7_end(主会话终)": 1789024888049,
  "b722d5da派生(mnemon)": 1789024918052,
}
for k, v in ts_list.items():
    print(k, datetime.datetime.fromtimestamp(v/1000).strftime("%H:%M:%S"))
