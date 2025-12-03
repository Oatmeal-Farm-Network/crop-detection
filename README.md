# 🌾 Crop & Soil Analytics Dashboard

A high-performance, responsive React application for analyzing agricultural field data. This dashboard visualizes crop types using vector tiles, provides real-time soil health analysis, and generates fertilizer recommendations based on Azure backend data.


## 🚀 Features

  * **Interactive Map Visualization:** Renders 2022 USDA crop data using MapLibre GL and PMTiles for high performance (handling millions of vector points).
  * **Field Analysis:** Click on any field to retrieve granular data including:
      * **Soil Health Score:** Calculated based on pH, Nitrogen, and Organic Carbon levels.
      * **Fertilizer Plan:** AI-generated recommendations for nutrient application.
      * **Crop Rotation History:** Historical timeline of crops grown on the plot.
  * **Location Search:** Integrated OpenStreetMap (Nominatim) search with ranking algorithms for accurate address finding.
  * **Mobile-First Design:** Fully responsive UI with a bottom-sheet drawer for mobile users and a sidebar for desktop users.
  * **Performance Optimized:** Uses custom memory management to run smoothly on devices with limited RAM.

## 🛠️ Tech Stack

  * **Frontend:** React.js, CSS3 (Custom responsive layout)
  * **Mapping:** MapLibre GL JS, PMTiles Protocol
  * **Icons:** Lucide React
  * **Deployment:** Docker, Nginx, Azure Web Apps
  * **Data Source:** USDA Cropland Data Layer (hosted on Azure Blob Storage)

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

  * [Node.js](https://nodejs.org/) (v16 or higher)
  * [Docker](https://www.docker.com/) (for containerization)
  * [Git](https://git-scm.com/)

## ⚡ Getting Started (Local Development)

Follow these steps to run the application on your local machine.

### 1\. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/REPO_NAME.git
cd REPO_NAME/src/crop-detection
```

### 2\. Install Dependencies

```bash
npm install
```

### 3\. Run the Development Server

```bash
# If using Create React App
npm start

# If using Vite
npm run dev
```

Open [http://localhost:3000](https://www.google.com/search?q=http://localhost:3000) (or the port shown in your terminal) to view it in the browser.

## 🐳 Docker Deployment

This project includes a multi-stage `Dockerfile` optimized for production (using Nginx).

### 1\. Build the Docker Image

Run this command from inside the `src/crop-detection` folder:

```bash
docker build -t crop-analytics-frontend .
```

### 2\. Run the Container

```bash
docker run -p 8080:80 crop-analytics-frontend
```

The app will be accessible at `http://localhost:8080`.

## 📂 Project Structure

```text
src/crop-detection/
├── public/             # Static assets
├── src/
│   ├── components/     # Reusable UI components
│   ├── App.jsx         # Main application logic & Map setup
│   ├── App.css         # Global styles & responsive definitions
│   └── index.js        # Entry point
├── Dockerfile          # Multi-stage build configuration
├── nginx.conf          # Nginx server configuration for React Router
├── package.json        # Dependencies and scripts
└── README.md           # Project documentation
```

## ☁️ Deployment to Azure

This project is configured for continuous deployment via GitHub Actions or Azure App Service.

1.  **Push to GitHub:** Ensure your Dockerfile is committed.
2.  **Create Web App:** In Azure Portal, create a "Web App for Containers".
3.  **Source:** Connect your GitHub repository.
4.  **Context:** Set the Docker build context to `src/crop-detection`.

## 🤝 Contributing

1.  Fork the repository.
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.

