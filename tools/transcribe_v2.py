import sys, os, time, glob
from funasr import AutoModel

IIC = r"D:\ailove\my-neuro\my-neuro\full-hub\asr-hub\model\asr\models\models\iic"
ASR = os.path.join(IIC, "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch")
VAD = os.path.join(IIC, "speech_fsmn_vad_zh-cn-16k-common-pytorch")
PUNC = os.path.join(IIC, "punc_ct-transformer_cn-en-common-vocab471067-large")

def load():
    return AutoModel(model=ASR, vad_model=VAD,
                     vad_kwargs={"max_single_segment_time": 60000},
                     punc_model=PUNC, device="cpu", disable_update=True)

def transcribe(model, wav_path):
    res = model.generate(input=wav_path, batch_size_s=300, hotword="")
    return res[0]["text"] if res else ""

def run_job(model, wdir, prefix, out_txt, offset_min, del_files):
    segs = sorted(glob.glob(os.path.join(wdir, prefix + "_seg_*.wav")))
    parts = []
    for s in segs:
        idx = int(os.path.basename(s).split("_seg_")[1].split(".")[0])
        start_min = offset_min + idx * 10
        t0 = time.time()
        t = transcribe(model, s)
        hh, mm = divmod(start_min, 60)
        parts.append("### [%02d:%02d 起，10 分钟段]" % (hh, mm))
        parts.append(t.strip())
        print("seg %d done: %d chars, %.1fs" % (idx, len(t), time.time() - t0), flush=True)
    open(out_txt, "w", encoding="utf-8").write("\n\n".join(parts))
    if os.path.getsize(out_txt) > 100:
        for s in segs:
            if os.path.exists(s):
                os.remove(s)
        for p in del_files:
            if p and os.path.exists(p):
                os.remove(p)
        print("CLEANED", prefix, flush=True)
    else:
        print("WARN: output too small, keep files", flush=True)

if __name__ == "__main__":
    mode = sys.argv[1]
    wdir = r"E:\music player\tools\asr_work"
    sdir = r"E:\music player\skills\horror-teller\samples"
    m = load()
    if mode == "job":
        prefix, fname, offset = sys.argv[2], sys.argv[3], int(sys.argv[4])
        run_job(m, wdir, prefix, os.path.join(sdir, fname), offset, sys.argv[5:])
    print("EXIT_OK", flush=True)
