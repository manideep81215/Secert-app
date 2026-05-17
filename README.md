# 🎮 Simp Games Quest

A full-stack web and mobile application featuring mini games, real-time chat, and love journey tracking. Built with React + Spring Boot, deployed with Capacitor for Android/iOS support.

---

## 📋 Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Icon Library](#icon-library)
- [Installation](#installation)
- [Development](#development)
- [Building](#building)
- [Deployment](#deployment)
- [Contributing](#contributing)

---

## ✨ Features

### Games
- 🪨 **Rock Paper Scissors** - Fast competitive rounds
- 🪙 **Coin Flip** - Quick decisions and playful challenges
- ❌ **Tic Tac Toe** - Classic two-player strategy
- 🪜 **Snake and Ladder** - Familiar board game experience

### Chat & Social
- 💬 Real-time messaging with WebSocket support
- 👥 User profiles with customization
- 🔔 Push notifications (native & web)
- 🔐 Secure authentication with JWT

### Love Features
- 💕 Love journey tracking
- 🎯 Milestone celebrations
- 📊 Monthly recaps
- ⏱️ Love timers

### Platform Support
- 🌐 Web application (React + Vite)
- 📱 Android app (Capacitor)
- 🍎 iOS app (Capacitor)
- 🔐 Biometric authentication support

---

## 📁 Project Structure

```
Secert app/
├── app/                          # Backend (Spring Boot)
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/            # Java source code
│   │   │   └── resources/       # Configuration files
│   │   └── test/
│   ├── pom.xml                  # Maven dependencies
│   ├── Dockerfile               # Docker configuration
│   └── mvnw / mvnw.cmd          # Maven wrapper
│
├── frontend/                     # Frontend (React + Vite)
│   ├── src/
│   │   ├── components/          # Reusable React components
│   │   ├── pages/               # Page components
│   │   ├── services/            # API service layers
│   │   ├── lib/                 # Utility libraries
│   │   ├── hooks/               # Custom React hooks
│   │   ├── context/             # React context providers
│   │   ├── config/              # Configuration files
│   │   ├── styles/              # Global styles
│   │   ├── assets/              # Static assets (sounds, etc.)
│   │   ├── App.jsx              # Main app component
│   │   └── main.jsx             # Entry point
│   ├── android/                 # Android app (Capacitor)
│   ├── public/                  # Static public files (HTML, manifest, robots.txt)
│   ├── package.json             # npm dependencies
│   ├── vite.config.js           # Vite configuration
│   ├── capacitor.config.json    # Capacitor configuration
│   └── eslint.config.js         # ESLint configuration
│
└── googlec62752f7d4b39b18.html  # Google verification file
```

---

## 🛠️ Tech Stack

### Frontend
- **React 19.2** - UI library
- **Vite 5.x** - Build tool with HMR
- **React Router 7.x** - Client-side routing
- **Tailwind CSS 4.1** - Utility-first CSS framework
- **Bootstrap 5.3** - CSS components
- **Framer Motion 12.x** - Animation library
- **Axios 1.13** - HTTP client
- **Capacitor 7.4** - Cross-platform mobile framework
- **React Toastify 11.x** - Toast notifications

### Backend
- **Spring Boot 4.0.2** - Web framework
- **Java 21** - Programming language
- **Spring Data JPA** - ORM
- **Spring Security** - Authentication & authorization
- **Spring WebMvc** - REST API
- **WebSocket** - Real-time communication

### Mobile/Platform
- **Capacitor** - iOS/Android bridge
- **Cordova Plugins** - Native functionality
- **Firebase** - Cloud services (Android)
- **Biometric Auth** - Device biometrics

### Storage & Communication
- **IndexedDB (IDB)** - Client-side database
- **SockJS** - WebSocket fallback
- **STOMP** - Message protocol

---

## 🎨 Icon Library

This project includes a custom SVG icon library optimized for the UI. All icons are fully accessible and customizable.

### Icon Components

#### 📎 **Attachment Icons** (`AttachmentIcons.jsx`)

```jsx
// Photo attachment icon
<PhotoAttachIcon size={20} className="custom-class" />
```
- **PhotoAttachIcon** - Gradient photo/gallery icon
- **CameraAttachIcon** - Camera device icon
- **FileAttachIcon** - Document/file icon
- **DriveAttachIcon** - Google Drive icon

**Icon Specifications:**
| Icon | Colors | Use Case |
|------|--------|----------|
| PhotoAttachIcon | Blue gradient, Yellow, Green | Upload photos/images |
| CameraAttachIcon | Blue, Orange, Gray, Dark | Capture photos with camera |
| FileAttachIcon | Black, Gray, Light | Upload documents |
| DriveAttachIcon | Blue, Green, Red | Cloud storage integration |

#### ⬅️ **Navigation Icons** (`BackIcon.jsx`)

```jsx
// Back/navigation icon
<BackIcon size={18} className="text-gray-700" />
```
- **BackIcon** - Left arrow for navigation

**Icon Specifications:**
- Inherits `currentColor` for styling
- Perfect for responsive sizing
- Supports `size` prop (default: 18px)

### Icon Usage Guide

```jsx
import { PhotoAttachIcon, CameraAttachIcon, FileAttachIcon, DriveAttachIcon } from './components/AttachmentIcons'
import BackIcon from './components/BackIcon'

// Basic usage
<PhotoAttachIcon size={24} />

// With custom styling
<CameraAttachIcon size={20} className="text-blue-500 hover:text-blue-700" />

// With dynamic size
<FileAttachIcon size={size} className="transition-transform" />
```

### Icon Props

All icons support the following props:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | number | 20 | Icon width and height in pixels |
| `className` | string | '' | CSS class names for styling |

### Accessibility

All icons include:
- ✅ `aria-hidden="true"` for decorative icons
- ✅ `focusable="false"` to exclude from focus order
- ✅ Semantic SVG markup
- ✅ Support for screen readers (with proper alt text in context)

---

## 🚀 Getting Started

### Prerequisites

- **Node.js 16+** or **18+**
- **Java 21+**
- **Maven 3.6+**
- **Git**
- **Docker** (optional, for containerization)

### Frontend Installation

```bash
cd frontend
npm install
```

### Backend Installation

```bash
cd app
# Maven is included via mvnw
./mvnw clean install
```

---

## 💻 Development

### Running the Frontend Dev Server

```bash
cd frontend
npm run dev
```

The app will be available at `http://localhost:5173` (or the next available port).

**Available Scripts:**
```bash
npm run dev         # Start development server
npm run build       # Build for production
npm run lint        # Run ESLint
npm run preview     # Preview production build
```

### Running the Backend

```bash
cd app
./mvnw spring-boot:run
```

The API will be available at `http://localhost:8080`.

### Running Mobile Apps (Capacitor)

```bash
# Sync and build for Android
npm run cap:android

# Sync and build for iOS
npm run cap:ios

# Just copy and sync changes
npm run cap:copy
npm run cap:sync
```

---

## 🏗️ Building

### Frontend Production Build

```bash
cd frontend
npm run build
```

Outputs to `frontend/dist/`

### Backend Production Build

```bash
cd app
./mvnw clean package -DskipTests
```

Outputs to `app/target/app-0.0.1-SNAPSHOT.jar`

### Docker Build

```bash
# Using the Dockerfile in the app directory
docker build -f app/Dockerfile -t simp-games-quest:latest .
```

---

## 🌐 Deployment

### Frontend Deployment
- **Vercel** - See `vercel.json` for configuration
- **Netlify** - Compatible with Vite builds
- **AWS S3 + CloudFront** - Static site hosting

### Backend Deployment
- **Spring Boot JAR** - Runs on any JVM server
- **Docker Container** - See `app/Dockerfile`
- **Cloud Platforms** - Azure App Service, AWS Elastic Beanstalk, Heroku

### Environment Configuration

Create `.env` files in both frontend and backend:

**frontend/.env.local**
```
VITE_API_URL=https://api.example.com
VITE_WS_URL=wss://api.example.com/ws
```

**app/application.properties**
```
spring.datasource.url=jdbc:mysql://localhost:3306/simpgames
spring.datasource.username=root
spring.datasource.password=password
```

---

## 📦 Dependencies Overview

### Key Frontend Libraries
- **React & React DOM** - UI framework
- **Vite** - Lightning-fast build tool
- **Tailwind CSS** - Utility-first styling
- **Capacitor** - Cross-platform mobile support
- **React Router** - Client-side routing
- **Framer Motion** - Smooth animations
- **Axios** - HTTP requests
- **React Toastify** - Notifications

### Key Backend Libraries
- **Spring Boot Starters** - Core framework
- **Spring Data JPA** - Database access
- **Spring Security** - Authentication
- **WebSocket Support** - Real-time features

---

## 🔐 Security Features

- 🔐 JWT-based authentication
- 🛡️ Spring Security integration
- 👆 Biometric authentication (Capacitor)
- 🔒 HTTPS/WSS for secure communication
- 🔓 Input validation and sanitization

---

## 📱 Mobile Features (Capacitor)

- 📸 Camera integration
- 📁 File system access
- 📍 Push notifications (native)
- ⚡ Haptic feedback
- ⌨️ Keyboard management
- 🎮 Local notifications
- 🔐 Biometric authentication

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 📞 Support

For issues, questions, or suggestions, please:
- 📧 Open an issue on GitHub
- 💬 Check the existing documentation
- 🐛 Report bugs with detailed information

---

## 🙏 Acknowledgments

- React and Vite communities
- Spring Boot team
- Capacitor for mobile support
- All contributors and users

---

**Happy Gaming! 🎮**
