"use strict"

const chalk = require("chalk")
const electron = require("electron")
const path = require("path")
const { spawn } = require("child_process")
const webpack = require("webpack")
const WebpackDevServer = require("webpack-dev-server")
const webpackHotMiddleware = require("webpack-hot-middleware")

const mainConfig = require("./webpack.electron.main")
const rendererConfig = require("./webpack.electron.renderer")
const splashscreenConfig = require("./webpack.electron.splashscreen")

let electronProcess = null
let manualRestart = false
let hotMiddleware
let splashscreenHotMiddleware

function logStats (proc, data) {
	let log = ""

	log += chalk.yellow.bold(`┏ ${proc} Process ${new Array((19 - proc.length) + 1).join("-")}`)
	log += "\n\n"

	if (typeof data === "object") {
		data.toString({
			colors: true,
			chunks: false
		}).split(/\r?\n/).forEach(line => {
			log += "  " + line + "\n"
		})
	}
	else {
		log += `  ${data}\n`
	}

	log += "\n" + chalk.yellow.bold(`┗ ${new Array(28 + 1).join("-")}`) + "\n"

	console.log(log)
}

function startRenderer () {
	return new Promise((resolve, reject) => {
		rendererConfig.entry.renderer = [ path.join(__dirname, "dev-client"), ].concat(rendererConfig.entry.renderer)
		splashscreenConfig.entry.splashscreen = [ path.join(__dirname, "dev-client"), ].concat(splashscreenConfig.entry.splashscreen)

		const rendererCompiler = webpack(rendererConfig)
		const splashscreenCompiler = webpack(splashscreenConfig)
		hotMiddleware = webpackHotMiddleware(rendererCompiler, { 
			log: false, 
			heartbeat: 2500 
		})
		splashscreenHotMiddleware = webpackHotMiddleware(splashscreenCompiler, { 
			log: false, 
			heartbeat: 2500 
		})

		splashscreenCompiler.plugin("compilation", compilation => {
			compilation.plugin("html-webpack-plugin-after-emit", (data, cb) => {
				splashscreenHotMiddleware.publish({ action: "reload" })
				if(typeof cb==="function") cb()
			})
		})
		rendererCompiler.plugin("compilation", compilation => {
			compilation.plugin("html-webpack-plugin-after-emit", (data, cb) => {
				hotMiddleware.publish({ action: "reload" })
				if(typeof cb==="function") cb()
			})
		})

		splashscreenCompiler.plugin("done", stats => {
			logStats("Splashscreen", stats)
		})
		rendererCompiler.plugin("done", stats => {
			logStats("Renderer", stats)
		})

		const splashscreenServer = new WebpackDevServer(
			splashscreenCompiler,
			{
				contentBase: path.join(__dirname, "../"),
				quiet: true,
				before (app, ctx) {
					app.use(splashscreenHotMiddleware)
					ctx.middleware.waitUntilValid(() => {
						resolve()
					})
				}
			}
		)
		const server = new WebpackDevServer(
			rendererCompiler,
			{
				contentBase: path.join(__dirname, "../"),
				quiet: true,
				before (app, ctx) {
					app.use(hotMiddleware)
					ctx.middleware.waitUntilValid(() => {
						resolve()
					})
				}
			}
		)

		server.listen(9080)
		splashscreenServer.listen(9081)
	})
}

function startMain () {
	return new Promise((resolve, reject) => {
		mainConfig.entry.main = [ path.join(__dirname, "../src/electron/index.dev.js"), ].concat(mainConfig.entry.main)

		const compiler = webpack(mainConfig)

		compiler.plugin("watch-run", (compilation, done) => {
			logStats("Main", chalk.white.bold("compiling..."))
			hotMiddleware.publish({ action: "compiling" })
			done()
		})

		compiler.watch({}, (err, stats) => {
			if (err) {
				console.log(err)
				return
			}

			logStats("Main", stats)

			if (electronProcess && electronProcess.kill) {
				manualRestart = true
				process.kill(electronProcess.pid)
				electronProcess = null
				startElectron()

				setTimeout(() => {
					manualRestart = false
				}, 5000)
			}

			resolve()
		})
	})
}

function startElectron () {
	electronProcess = spawn(electron, [ "--inspect=5858", path.join(__dirname, "../dist/electron/main.js"),  ])

	electronProcess.stdout.on("data", data => {
		electronLog(data, "blue")
	})
	electronProcess.stderr.on("data", data => {
		electronLog(data, "red")
	})

	electronProcess.on("close", () => {
		if (!manualRestart) process.exit()
	})
}

function electronLog (data, color) {
	let log = ""
	data = data.toString().split(/\r?\n/)
	data.forEach(line => {
		log += `  ${line}\n`
	})
	if (/[0-9A-z]+/.test(log)) {
		console.log(
			chalk[color].bold("┏ Electron -------------------") +
      "\n\n" +
      log +
      chalk[color].bold("┗ ----------------------------") +
      "\n"
		)
	}
}

function greeting () {
	console.log(chalk.yellow.bold("\n  electron-vue"))
	console.log(chalk.blue("  getting ready...") + "\n")
}

function init () {
	greeting()

	Promise.all([ startRenderer(), startMain(),  ])
		.then(() => {
			startElectron()
		})
		.catch(err => {
			console.error(err)
		})
}

init()
