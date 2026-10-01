#!/bin/sh
# concat the rendered segments, add the soundtrack (loudness-normalised to -14 LUFS), write the masters
set -e
cd "$(dirname "$0")/.."
printf "file 'a.mp4'\nfile 'b.mp4'\nfile 'c1.mp4'\nfile 'c2.mp4'\n" > build/seg/list.txt
ffmpeg -v error -y -f concat -safe 0 -i build/seg/list.txt -c copy build/seg/video.mp4
rm -f out/*.mp4
# 1. FULL HD master: 1080p60, near-lossless H.264 (CRF 16), AAC 320k
ffmpeg -v error -y -i build/seg/video.mp4 -i build/mix.wav -map 0:v -map 1:a -c:v copy \
  -af "loudnorm=I=-14:TP=-1:LRA=11,afade=t=out:st=63.9:d=0.7" -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart \
  "out/MiG-29K Launch Film - FULL HD 1080p60.mp4"
# 2. LinkedIn: 1080p30, two-pass 4.2 Mbps (about 35 MB), AAC 160k: well inside LinkedIn's upload limits
M="out/MiG-29K Launch Film - FULL HD 1080p60.mp4"
ffmpeg -v error -y -i "$M" -vf "fps=30,hqdn3d=1.2:1.2:2.5:2.5" -c:v libx264 -preset slow -b:v 4200k -pass 1 -passlogfile build/x264pass -an -f mp4 /dev/null
ffmpeg -v error -y -i "$M" -vf "fps=30,hqdn3d=1.2:1.2:2.5:2.5" -c:v libx264 -preset slow -b:v 4200k -maxrate 6M -bufsize 12M -pass 2 -passlogfile build/x264pass \
  -pix_fmt yuv420p -profile:v high -c:a aac -b:a 160k -ar 48000 -movflags +faststart "out/MiG-29K Launch Film - LinkedIn.mp4"
ls -la out/
