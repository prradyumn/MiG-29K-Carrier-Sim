#!/bin/sh
# LinkedIn deliverable only: concat the rendered segments, add the soundtrack (loudness-normalised to -14 LUFS),
# then a two-pass 1080p30 H.264 encode sized for LinkedIn: 64.6 s at ~5.0 Mbps video + 160 kbps AAC ~ 42 MB.
set -e
cd "$(dirname "$0")/.."
printf "file 'a.mp4'\nfile 'b.mp4'\nfile 'c1.mp4'\nfile 'c2.mp4'\n" > build/seg/list.txt
ffmpeg -v error -y -f concat -safe 0 -i build/seg/list.txt -c copy build/seg/video.mp4
ffmpeg -v error -y -i build/seg/video.mp4 -i build/mix.wav -map 0:v -map 1:a -c:v copy \
  -af "loudnorm=I=-14:TP=-1:LRA=11,afade=t=out:st=63.9:d=0.7" -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart build/master.mp4
OUT="out/MiG-29K Launch Film - LinkedIn v2.mp4"
ffmpeg -v error -y -i build/master.mp4 -vf "fps=30,hqdn3d=1.2:1.2:2.5:2.5" -c:v libx264 -preset slow -b:v 5000k -pass 1 -passlogfile build/x264pass -an -f mp4 /dev/null
ffmpeg -v error -y -i build/master.mp4 -vf "fps=30,hqdn3d=1.2:1.2:2.5:2.5" -c:v libx264 -preset slow -b:v 5000k -maxrate 7M -bufsize 14M -pass 2 -passlogfile build/x264pass \
  -pix_fmt yuv420p -profile:v high -c:a aac -b:a 160k -ar 48000 -movflags +faststart "$OUT"
ls -la "$OUT"
