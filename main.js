import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { inject } from "@vercel/analytics"; 
inject();

// ---- DOM references ----
const videoEl = document.getElementById("webcam");
const canvasEl = document.getElementById("overlay");
const ctx = canvasEl.getContext("2d");
const startOverlayEl = document.getElementById("startOverlay");
const helpButton = document.getElementById("helpButton");
const helpModal = document.getElementById("helpModal");
const closeHelp = document.getElementById("closeHelp");
const fingerDisplayEl = document.getElementById("fingerDisplay");
const kgntType = document.getElementById("kgntType");

// ---- True Distance/Touch Collision ----
function getDistance(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Checks if the distance between two specific dots is close enough to be a "bend/touch"
function isTouching(landmarks, dot1, dot2) {
  const p1 = landmarks[dot1];
  const p2 = landmarks[dot2];
  
  if (!p1 || !p2) return false;

  const distance = getDistance(p1, p2);
   
  //0.08 for a lighter bend and 0.03 for a very tight squeeze
  return distance < 0.06; 
}

function isThumbExtended(landmarks, handedness) {
  const thumbTip = landmarks[4];
  const pinkyBase = landmarks[17];
  
  if (!thumbTip || !pinkyBase) return false;
  const distance = getDistance(thumbTip, pinkyBase);
  return distance > 0.12; 
}


class MultiTriggerEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isLoaded = false;
     
    this.loadKit(kgntType.value);

    kgntType.addEventListener("change", async (e) => {
      this.loadKit(e.target.value);
      if (this.ctx) {
        this.isLoaded = false; 
        await this.loadAllSounds(); 
      }
    });
  }

  loadKit(kitName) {
    if (kitName === "silecherinetih") {
      this.voices = {
        thumb:  { file: "/sounds/G.wav", buffer: null, source: null, active: false, lastTriggerTime: 0, name: "Thumb" },
        index:  { file: "/sounds/D.wav", buffer: null, source: null, active: false, lastTriggerTime: 0, name: "Index" },
        middle: { file: "/sounds/Ds.wav", buffer: null, source: null, active: false, lastTriggerTime: 0, name: "Middle" },
        ring:   { file: "/sounds/B.wav", buffer: null, source: null, active: false, lastTriggerTime: 0, name: "Ring" },
        pinky:  { file: "/sounds/Gs.wav", buffer: null, source: null, active: false, lastTriggerTime: 0, name: "Pinky" }
      };
    } 
    else if (kitName === "selamta") {
      this.voices = {
        thumb:  { file: "/sounds/selamta/thumb.wav", buffer: null, source: null, active: false, lastTriggerTime: 0, name: "Thumb" },
        index:  { file: "/sounds/selamta/index.wav", buffer: null, source: null, active: false, lastTriggerTime: 0, name: "Index" },
        middle: { file: "/sounds/selamta/middle.wav", buffer: null, source: null, active: false, lastTriggerTime: 0, name: "Middle" },
        ring:   { file: "/sounds/selamta/ring.wav", buffer: null, source: null, active: false, lastTriggerTime: 0, name: "Ring" },
        pinky:  { file: "/sounds/selamta/pinky.wav", buffer: null, source: null, active: false, lastTriggerTime: 0, name: "Pinky" }
      };
    }
    else{
      this.voices = {};
    }
  }

 
  async ensureContext() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5; // Master volume (0.0 to 1.0)
    this.masterGain.connect(this.ctx.destination);

    // Fetch and decode all audio files before allowing playback
    await this.loadAllSounds();
  }

  async loadAllSounds() {
    const loadPromises = Object.keys(this.voices).map(async (key) => {
      const voice = this.voices[key];
      try {
        const response = await fetch(voice.file);
        const arrayBuffer = await response.arrayBuffer();
        voice.buffer = await this.ctx.decodeAudioData(arrayBuffer);
      } catch (error) {
        console.error(`Failed to load ${voice.file}. Check the file path and spelling.`, error);
      }
    });

    await Promise.all(loadPromises);
    this.isLoaded = true;
  }

  updateFingerState(fingerKey, isTriggered) {
    if (!this.ctx || !this.isLoaded) return;
    const voice = this.voices[fingerKey];
    
    if (!voice.buffer) return; 
    const COOLDOWN_MS = 250; 
    const now = performance.now();

    if (isTriggered && !voice.active) {
      // Prevent playin if the cooldown hasn't finished yet
      if (now - voice.lastTriggerTime < COOLDOWN_MS) return;

      voice.active = true;
      voice.lastTriggerTime = now; 
      
      voice.source = this.ctx.createBufferSource();
      voice.source.buffer = voice.buffer;
      voice.source.loop = false; 
      
      const gainNode = this.ctx.createGain();
      gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 0.05); 
      
      voice.source.connect(gainNode);
      gainNode.connect(this.masterGain);
      voice.source.start();
      voice.gainNode = gainNode;
    } 
    else if (!isTriggered && voice.active) {
      if (now - voice.lastTriggerTime > COOLDOWN_MS) {
        voice.active = false;
      }
    }
  }

  getActiveFingers() {
    return Object.keys(this.voices)
      .filter(key => this.voices[key].active)
      .map(key => this.voices[key].name);
  }
}

const audioEngine = new MultiTriggerEngine();

startOverlayEl.addEventListener("click", async () => {
  const startText = startOverlayEl.querySelector(".start-text");
  if (startText) startText.textContent = "Loading sounds...";
  
  await audioEngine.ensureContext();
  
  startOverlayEl.style.display = "none";
  canvasEl.classList.remove("dimmed");
});

helpButton.addEventListener("click", () => helpModal.classList.remove("hidden"));
closeHelp.addEventListener("click", (e) => {
  e.stopPropagation();
  helpModal.classList.add("hidden");
});

function computeCoverRect(srcW, srcH, dstW, dstH) {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;
  if (srcRatio > dstRatio) {
    const sWidth = srcH * dstRatio;
    return { sx: (srcW - sWidth) / 2, sy: 0, sWidth, sHeight: srcH };
  } else {
    const sHeight = srcW / dstRatio;
    return { sx: 0, sy: (srcH - sHeight) / 2, sWidth: srcW, sHeight };
  }
}

function drawFrame(results, canvasWidth, canvasHeight) {
  const srcW = videoEl.videoWidth;
  const srcH = videoEl.videoHeight;
  if (!srcW || !srcH) return;

  const { sx, sy, sWidth, sHeight } = computeCoverRect(srcW, srcH, canvasWidth, canvasHeight);

  ctx.save();
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.translate(canvasWidth, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, sx, sy, sWidth, sHeight, 0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = "#e8a13d";
  for (const landmarks of results.landmarks) {
    for (const point of landmarks) {
      const canvasX = (((point.x * srcW) - sx) / sWidth) * canvasWidth;
      const canvasY = (((point.y * srcH) - sy) / sHeight) * canvasHeight;
      ctx.beginPath();
      ctx.arc(canvasX, canvasY, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ 
    video: { 
      width: { ideal: 640 }, 
      height: { ideal: 480 },
      facingMode: "user" //Forces the phone to use the front selfie camera
    }, 
    audio: false 
  });
  videoEl.srcObject = stream;
  return new Promise((resolve) => {
    videoEl.onloadedmetadata = () => { videoEl.play(); resolve(); };
  });
}

async function setupHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
  });
}

function resizeCanvas() {
  canvasEl.width = window.innerWidth;
  canvasEl.height = window.innerHeight;
}

async function main() {
  await setupCamera();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  const handLandmarker = await setupHandLandmarker();
  let lastVideoTime = -1;

  function loop() {
    const timestampNow = performance.now();

    try {
      // Added a readyState check so it doesn't try to analyze empty frames
      if (videoEl.currentTime !== lastVideoTime && videoEl.readyState >= 2) {
        lastVideoTime = videoEl.currentTime;
        
        const results = handLandmarker.detectForVideo(videoEl, timestampNow);
        drawFrame(results, canvasEl.width, canvasEl.height);

        // Ensure both landmarks AND handedness data exist before processing
        if (results.landmarks && results.landmarks.length > 0 && results.handedness.length > 0) {
          const hand = results.landmarks[0];
          const handedness = results.handedness[0][0].categoryName;

          audioEngine.updateFingerState("thumb", !isThumbExtended(hand, handedness));
          audioEngine.updateFingerState("index", isTouching(hand, 8, 6));   // Index Tip (8) to 2nd Joint (6)
          audioEngine.updateFingerState("middle", isTouching(hand, 12, 10)); // Middle Tip (12) to 2nd Joint (10)
          audioEngine.updateFingerState("ring", isTouching(hand, 16, 14));  // Ring Tip (16) to 2nd Joint (14)
          audioEngine.updateFingerState("pinky", isTouching(hand, 20, 18)); // Pinky Tip (20) to 2nd Joint (18)
          
          const activeList = audioEngine.getActiveFingers();
          fingerDisplayEl.textContent = activeList.length > 0 ? activeList.join(" | ") : "--";
        } else {
          // If hand is lost, re-arm all triggers
          Object.keys(audioEngine.voices).forEach(key => audioEngine.updateFingerState(key, false));
          fingerDisplayEl.textContent = "--";
        }
      }
    } catch (error) {
      // If a math error happens, log it but DO NOT freeze the app
      console.error("Frame skipped due to error:", error);
    }

    requestAnimationFrame(loop);
  }
  loop();
}

main().catch((err) => console.error(err));