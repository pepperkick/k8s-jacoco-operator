const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')

// https://repo1.maven.org/maven2/org/jacoco/org.jacoco.agent/${ver}/org.jacoco.agent-${ver}.jar

// vars needed
// agent version, download location
const agentVersions = process.env.AGENT_VERSIONS ? process.env.AGENT_VERSIONS.split(',') : ['0.7.8', '0.8.8', '0.8.11']
const downloadDir = process.env.DOWNLOAD_DIR || '/mnt/jacoco'

const downloadAgent = (agentVersion, callback) => {
  // check if it's already there
  // agent jars will go to ${downloadDir}/${agentVersion}/jacoco.jar
  const agentDirPath = path.join(downloadDir, agentVersion)

  fs.stat(agentDirPath, (err) => {
    if (!err) {
      console.log('Agent already exists, skipping download')
      return
    }
    fs.mkdir(agentDirPath, {
      recursive: true
    }, (err) => {
      if (err) {
        console.error('Failed to create agent folder: ', err)
        process.exit(1)
        return
      }

      // folder now exists, agent jar does not, lets download it
      const req = https.request({
        hostname: 'repo1.maven.org',
        port: 443,
        path: `maven2/org/jacoco/org.jacoco.agent/${agentVersion}/org.jacoco.agent-${agentVersion}-runtime.jar`
      }, (res) => {
        if (res.statusCode === 200) {
          const jarPath = path.join(downloadDir, agentVersion, 'jacoco.jar')
          const fileStream = fs.createWriteStream(jarPath)
          console.log(`Downloading to ${jarPath}`)
          res.pipe(fileStream)
          fileStream.on('finish', () => {
            fileStream.close()
            console.log('Download complete')
            callback(null)
          })
        } else {
          console.error(`Unexpected status code response: ${res.statusCode}`)
          process.exit(2)
        }
      })
      // log errors
      req.on('error', console.error)
      // close the request stream
      req.end()
    })
  })
}

// Function to download all agent versions
const downloadAllAgents = (versions, callback) => {
  let index = 0

  const next = (err) => {
    if (err) {
      callback(err)
      return
    }
    if (index < versions.length) {
      downloadAgent(versions[index], (err) => {
        index++
        next(err)
      })
    } else {
      callback()
    }
  }

  next()
}

const downloadCli = (callback) => {
  // check if it's already there
  // cli jars will go to ${downloadDir}/jacoco-cli/jacoco.jar
  const cliDirPath = path.join(downloadDir, "jacoco-cli")

  fs.stat(cliDirPath, (err) => {
    if (!err) {
      console.log('CLI already exists, skipping download')
      return
    }

    fs.mkdir(cliDirPath, {
      recursive: true
    }, (err) => {
      if (err) {
        console.error('Failed to create CLI folder: ', err)
        process.exit(1)
        return
      }

      // folder now exists, agent jar does not, lets download it
      const req = https.request({
        hostname: 'repo1.maven.org',
        port: 443,
        path: `maven2/org/jacoco/org.jacoco.cli/0.8.12/org.jacoco.cli-0.8.12-nodeps.jar`
      }, (res) => {
        if (res.statusCode === 200) {
          const jarPath = path.join(downloadDir, "jacoco-cli", 'jacoco-cli.jar')
          const fileStream = fs.createWriteStream(jarPath)
          console.log(`Downloading to ${jarPath}`)
          res.pipe(fileStream)
          fileStream.on('finish', () => {
            fileStream.close()
            console.log('Download complete')
            callback(null)
          })
        } else {
          console.error(`Unexpected status code response: ${res.statusCode}`)
          process.exit(2)
        }
      })
      // log errors
      req.on('error', console.error)
      // close the request stream
      req.end()
    })
  })
}

// Start downloading all agent versions
downloadAllAgents(agentVersions, (err) => {
  if (err) {
    console.error('Failed to download all agents: ', err)
    process.exit(1)
  } else {
    console.log('All agents downloaded successfully')
  }
})

downloadCli((err) => {
  if (err) {
    console.error('Failed to download CLI: ', err)
    process.exit(1)
  } else {
    console.log('All agents downloaded successfully')
  }
})