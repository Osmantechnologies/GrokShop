# Cuts the Grokazon demo: python grokazon/video/assemble.py
# raw tour (frames.txt, real frame durations) -> 30 fps 1080p, numbered captions faded in over each step (marks.json),
# opener and closer cards joined with 0.5 s crossfades. Silent (no music licence needed).
# Writes video/out/grokazon-demo.mp4 (crf 18) and grokazon-demo-x.mp4 (crf 23, smaller, for posting on X).
import json, os, subprocess
D = os.path.dirname(os.path.abspath(__file__)); O = os.path.join(D, 'out'); C = os.path.join(O, 'cards')
run = lambda a: subprocess.run(a, check=True, cwd=O, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

# 1) the tour as a clean 30 fps clip
run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', 'frames.txt', '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', 'tour.mp4'])
dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'tour.mp4'], cwd=O, capture_output=True, text=True).stdout)

# 2) captions over the tour
marks = json.load(open(os.path.join(O, 'marks.json')))
steps = [m for m in marks if m['id'] != 'end']
ends = [m['t'] for m in marks[1:]]
inputs, chain, last = ['-i', 'tour.mp4'], [], '0:v'
idx = 1
for k, (m, end) in enumerate(zip(steps, ends)):
    # steps that start with a click on another page: the caption waits for that page to load
    a, b = m['t'] + (0.5 if m['id'] in ('store', 'ask') else 1.5), min(end, dur) - 0.25
    if b - a < 1.2: continue
    d = b - a
    inputs += ['-loop', '1', '-t', f'{d:.2f}', '-i', os.path.join(C, f"lt-{m['id']}.png")]
    chain.append(f"[{idx}:v]format=rgba,fade=in:st=0:d=0.35:alpha=1,fade=out:st={d - 0.35:.2f}:d=0.35:alpha=1,setpts=PTS-STARTPTS+{a:.2f}/TB[c{idx}]")
    chain.append(f"[{last}][c{idx}]overlay=0:0:enable='between(t,{a:.2f},{b:.2f})'[v{idx}]")
    last = f'v{idx}'; idx += 1
run(['ffmpeg', '-y'] + inputs + ['-filter_complex', ';'.join(chain), '-map', f'[{last}]', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', 'tour-captioned.mp4'])

# 3) tour + closer with a crossfade (owner, 2026-10-16: no intro card; the video opens straight on the store)
OP, CL, X = 0.0, 3.5, 0.5
g = (f"[0:v]fps=30,format=yuv420p,setsar=1[t];[1:v]scale=1920:1080,fps=30,format=yuv420p,setsar=1[c];"
     f"[t][c]xfade=transition=fade:duration={X}:offset={dur - X}[v]")
base = ['ffmpeg', '-y', '-i', 'tour-captioned.mp4', '-loop', '1', '-t', str(CL), '-i', os.path.join(C, 'closer.png'), '-filter_complex', g, '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-movflags', '+faststart']
run(base + ['-crf', '18', 'grokazon-demo.mp4'])
run(base + ['-crf', '23', '-maxrate', '6M', '-bufsize', '12M', 'grokazon-demo-x.mp4'])
for f in ['grokazon-demo.mp4', 'grokazon-demo-x.mp4']:
    print(f, round(os.path.getsize(os.path.join(O, f)) / 1e6, 1), 'MB')
print('length', round(dur + CL - X, 1), 's')
# contact sheet to judge the cut without watching
run(['ffmpeg', '-y', '-i', 'grokazon-demo-x.mp4', '-vf', 'fps=1/3,scale=480:-1,tile=4x6', '-frames:v', '1', 'contact.png'])
