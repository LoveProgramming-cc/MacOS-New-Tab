export const STORAGE_KEY = "macOsDataV37";

export const WIDGET_MEDIA_KEY = "macOsWidgetMediaV41";
export const WIDGET_PHOTO_STATE_KEY = "macOsWidgetPhotoStateV51";

export const ENGINES = {
    "google": {
        "name": "Google",
        "url": "https://www.google.com/search?q="
    },
    "bing": {
        "name": "Bing",
        "url": "https://www.bing.com/search?q="
    },
    "duck": {
        "name": "DuckDuckGo",
        "url": "https://duckduckgo.com/?q="
    },
    "chatgpt": {
        "name": "ChatGPT",
        "url": "https://chatgpt.com/?q="
    }
};

export const FALLBACK_CONFIG = {
    "language": "zh-CN",
    "themeMode": "system",
    "useBingWallpaper": false,
    "wallpaperLight": "assets/images/sequoia.shape.day.jpg",
    "wallpaperDark": "assets/images/sequoia.shape.night.jpg",
    "searchEngine": "google",
    "showSpotlightOnStart": true,
    "spotlightFocusOnOpen": false,
    "developer": {
        "enabled": false,
        "timeScale": 1,
        "baseRealMs": 0,
        "baseVirtualMs": 0,
        "secondsBase": false,
        "disableExtraFeatures": false,
        "selectableUIText": false,
        "disableStrictPluginSecurity": false,
        "allowSystemIconEditing": false,
        "launchpadRows": 0,
        "launchpadCols": 0,
        "incognitoMode": false
    },
    "desktop": {
        "snapToGrid": true,
        "sortMode": "manual"
    },
    "dock": {
        "size": 56,
        "magnification": 45,
        "iconBg": true,
        "lightBgInDark": true
    },
    "shortcuts": {
        "spotlightModifier": "Meta",
        "spotlightKey": "Space"
    },
    "aboutMac": {
        "chip": "Intel N200",
        "disk": "Macintosh HD",
        "memory": "8 GB",
        "model": "Chromebook Pro (11英寸, 2026)",
        "osName": "macOS NewTab",
        "osVersion": "15.7.3"
    },
    "desktopApps": [
        {
            "name": "Bilibili",
            "enName": "Bilibili",
            "url": "https://www.bilibili.com",
            "icon": "assets/images/Safari浏览器.png",
            "isSystem": false,
            "useBg": true,
            "cx": 88,
            "cy": 15
        }
    ],
    "dockApps": [
        {
            "name": "访达",
            "enName": "Finder",
            "url": "chrome://bookmarks/",
            "icon": "assets/images/访达.png",
            "isSystem": false,
            "useBg": true,
            "nameKey": "appFinder",
            "protected": true
        },
        {
            "name": "启动台",
            "enName": "Launchpad",
            "action": "toggleLaunchpad",
            "icon": "assets/images/启动台.png",
            "isSystem": true,
            "nameKey": "appLaunchpad",
            "protected": true
        },
        {
            "name": "Safari浏览器",
            "enName": "Safari",
            "url": "https://www.google.com",
            "icon": "assets/images/Safari浏览器.png",
            "isSystem": false,
            "useBg": false,
            "nameKey": "appSafari",
            "protected": false
        },
        {
            "name": "系统偏好设置",
            "enName": "System Settings",
            "action": "toggleSettings",
            "icon": "assets/images/系统设置.png",
            "isSystem": true,
            "nameKey": "appSystemSettings",
            "protected": false
        }
    ],
    "quickLinks": [
        {
            "name": "Google",
            "enName": "Google",
            "url": "https://www.google.com",
            "icon": "assets/images/Safari浏览器.png",
            "useBg": true
        },
        {
            "name": "GitHub",
            "enName": "GitHub",
            "url": "https://github.com",
            "icon": "assets/images/访达.png",
            "useBg": true
        }
    ],
    "launchpadApps": [
        {
            "icon": "assets/images/访达.png",
            "name": "访达",
            "enName": "Finder",
            "url": "https://www.icloud.com/iclouddrive/",
            "useBg": true,
            "nameKey": "appFinder",
            "protected": true,
            "isSystem": true
        },
        {
            "icon": "assets/images/Safari浏览器.png",
            "name": "Safari浏览器",
            "enName": "Safari",
            "url": "https://www.google.com",
            "useBg": false,
            "nameKey": "appSafari",
            "protected": true,
            "isSystem": true
        },
        {
            "icon": "assets/images/邮件.png",
            "name": "邮件",
            "enName": "Mail",
            "url": "https://www.icloud.com/mail/",
            "useBg": false,
            "nameKey": "appMail",
            "protected": true,
            "isSystem": true
        },
        {
            "icon": "assets/images/照片.png",
            "name": "照片",
            "enName": "Photos",
            "url": "https://www.icloud.com/photos/",
            "useBg": false,
            "nameKey": "appPhotos",
            "protected": true,
            "isSystem": true
        },
        {
            "icon": "assets/images/日历.png",
            "name": "日历",
            "enName": "Calendar",
            "url": "https://www.icloud.com/calendar/",
            "useBg": false,
            "nameKey": "appCalendar",
            "protected": true,
            "isSystem": true
        },
        {
            "icon": "assets/images/备忘录.png",
            "name": "备忘录",
            "enName": "Notes",
            "url": "https://www.icloud.com/notes/",
            "useBg": false,
            "nameKey": "appNotes",
            "protected": true,
            "isSystem": true
        },
        {
            "action": "toggleSettings",
            "icon": "assets/images/系统设置.png",
            "name": "系统偏好设置",
            "enName": "System Settings",
            "useBg": false,
            "nameKey": "appSystemSettings",
            "protected": true,
            "isSystem": true
        },
        {
            "icon": "assets/images/提醒事项.png",
            "name": "提醒事项",
            "enName": "Reminders",
            "url": "https://www.icloud.com/reminders/",
            "useBg": false,
            "nameKey": "appReminders",
            "protected": true,
            "isSystem": true
        },
        {
            "icon": "assets/images/查找.png",
            "name": "查找",
            "enName": "Find My",
            "url": "https://www.icloud.com/find/",
            "useBg": false,
            "nameKey": "appFindMy",
            "protected": true,
            "isSystem": true
        },
        {
            "icon": "assets/images/地图.png",
            "name": "地图",
            "enName": "Maps",
            "url": "https://maps.apple.com/",
            "useBg": false,
            "nameKey": "appMaps",
            "protected": true,
            "isSystem": true
        },
        {
            "icon": "assets/images/App Store.png",
            "name": "App Store",
            "enName": "App Store",
            "url": "https://chromewebstore.google.com/?utm_source=chrome-app-launcher",
            "useBg": true,
            "nameKey": "appAppStore",
            "protected": true,
            "isSystem": true
        }
    ],
    "widgets": {
        "center": [
            {
                "id": "center-world-clock",
                "type": "clock",
                "variant": "world",
                "size": "medium"
            },
            {
                "id": "center-weather",
                "type": "weather",
                "variant": "forecast",
                "size": "medium",
                "weatherLocationId": "weather-singapore"
            },
            {
                "id": "center-screen-time",
                "type": "screenTime",
                "variant": "summary",
                "size": "medium"
            },
            {
                "id": "center-battery",
                "type": "battery",
                "variant": "status",
                "size": "medium"
            }
        ],
        "desktop": [],
        "weather": {
            "locations": [
                {
                    "id": "weather-singapore",
                    "label": "Singapore",
                    "admin1": "",
                    "country": "Singapore",
                    "latitude": 1.3521,
                    "longitude": 103.8198,
                    "timezone": "Asia/Singapore"
                }
            ],
            "defaultLocationId": "weather-singapore"
        },
        "photos": {
            "mode": "cycle",
            "intervalSeconds": 30,
            "selectedIndex": 0
        },
        "screenTime": {
            "enabled": true,
            "limits": [],
            "overlayMessage": "",
            "overlayImage": "",
            "overlayImageMaxWidth": 320,
            "overlayImageMaxHeight": 220,
            "overlayTextFontSize": 20,
            "overlayTextColor": "#1d1d1f",
            "overlayFontName": "",
            "overlayFontData": ""
        }
    },
    "plugins": {
        "installed": [],
        "activeLimitOverlay": "builtin"
    },
    "dockFolders": [
        {
            "name": "下载",
            "enName": "Downloads",
            "nameKey": "dockDownloads",
            "url": "chrome://downloads/",
            "icon": "assets/images/Folder.png",
            "isSystem": false,
            "protected": false,
            "useBg": false,
            "addedAt": 0,
            "lastAccessedAt": 0
        }
    ],
    "trashItems": []
};
