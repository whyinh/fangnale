import { ExpoConfig, ConfigContext } from 'expo/config';

const appName = process.env.COZE_PROJECT_NAME || process.env.EXPO_PUBLIC_COZE_PROJECT_NAME || '应用';
const projectId = process.env.COZE_PROJECT_ID || process.env.EXPO_PUBLIC_COZE_PROJECT_ID;
const slugAppName = projectId ? `app${projectId}` : 'myapp';

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    "name": appName,
    "slug": slugAppName,
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "fangnale",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "ios": {
      // ⚠️ bundleIdentifier 一经发布不可更改，上架前请确认
      "bundleIdentifier": "com.fangnale.app",
      "buildNumber": "1",
      // 暂不适配 iPad（仅需 iPhone 截图即可提审）
      "supportsTablet": false,
      "infoPlist": {
        // 仅使用 HTTPS 标准加密，属出口合规豁免（避免每次提审手动填加密问卷）
        "ITSAppUsesNonExemptEncryption": false
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": `com.anonymous.x${projectId || '0'}`
    },
    "web": {
      "bundler": "metro",
      "output": "single",
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL ? [
        "expo-router",
        {
          "origin": process.env.EXPO_PUBLIC_BACKEND_BASE_URL
        }
      ] : 'expo-router',
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#ffffff"
        }
      ],
      [
        "expo-image-picker",
        {
          "photosPermission": `允许"放哪了"访问相册，以便选择物品照片进行 AI 识别并记录存放位置。`,
          "cameraPermission": `允许"放哪了"使用相机拍摄物品照片，用于 AI 识别并记录物品存放位置。`
        }
      ],
      [
        "expo-av",
        {
          "microphonePermission": `允许"放哪了"使用麦克风，以便通过语音快速记录和查找物品。`
        }
      ],
      [
        "expo-camera",
        {
          "cameraPermission": `允许"放哪了"使用相机拍摄物品照片，用于 AI 识别并记录物品存放位置。`,
          "recordAudioAndroid": false
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true
    }
  }
}
