import { inject, injectable } from 'inversify'
import { TYPES } from '../types'
import { Logger } from 'pino'
import { V1Pod, V1PodSpec } from '@kubernetes/client-node'
import * as jsonpatch from 'fast-json-patch'

export interface IAdmission {
  /**
   * Take a pod and return the patch required for admission, [] if no patch operations are required
   * @param pod raw pod that necessary patches will be applied to
   * @returns string a JSON string of the JSONPatch
   */
  admit(pod: V1Pod): Promise<string>
}

@injectable()
export class Admission implements IAdmission {
  private readonly logger: Logger
  private readonly agentVersion: string
  private readonly coveragePvcName: string
  private readonly agentPvcName: string

  constructor (
    @inject(TYPES.Services.Logging)parentLogger: Logger,
    @inject(TYPES.Config.AgentPvc)agentPvcName: string,
    @inject(TYPES.Config.CoveragePvc)coveragePvcName: string,
    @inject(TYPES.Config.AgentVersion)agentVersion: string) {
    this.logger = parentLogger.child({ module: 'services/Admission' })
    this.agentPvcName = agentPvcName
    this.agentVersion = agentVersion
    this.coveragePvcName = coveragePvcName
  }

  async admit (pod: V1Pod): Promise<string> {
    const observer = jsonpatch.observe<V1Pod>(pod)
    const spec = pod.spec as V1PodSpec

    let podName = pod.metadata?.name
    if (!podName) {
      // Pod name is not generated yet, have to generate one
      podName = pod.metadata?.generateName + randomString(16)
    }
    if (!podName) {
      this.logger.warn('Failed to get or generate pod name')
    }

    const targetContainersAnnotation = 'jacoco-operator.curium.rocks/target-containers'
    const agentVersionAnnotation = 'jacoco-operator.curium.rocks/agent-version'
    const agentTcpServerAddressAnnotation = 'jacoco-operator.curium.rocks/agent-tcp-server-address'
    const agentTcpServerPortAnnotation = 'jacoco-operator.curium.rocks/agent-tcp-server-port'

    let agentVersion = this.agentVersion
    let enableTcpServer = false
    let tcpServerAddress = '*'
    let tcpServerPort = '6300'

    // look for the container name annotation
    if (!pod.metadata || !pod.metadata.annotations || !pod.metadata.annotations[targetContainersAnnotation]) return '[]'
    if (pod.metadata && pod.metadata.annotations && pod.metadata.annotations[agentVersionAnnotation]) {
      agentVersion = pod.metadata.annotations[agentVersionAnnotation]
    }

    if (pod.metadata && pod.metadata.annotations && pod.metadata.annotations[agentTcpServerAddressAnnotation] && pod.metadata.annotations[agentTcpServerPortAnnotation]) {
      enableTcpServer = true
      tcpServerAddress = pod.metadata.annotations[agentTcpServerAddressAnnotation]
      tcpServerPort = pod.metadata.annotations[agentTcpServerPortAnnotation]
    }

    const targetContainers = pod.metadata?.annotations[targetContainersAnnotation].split(',')
    const includeMap = targetContainers.map((c) => spec.containers.some((cont) => cont.name === c))
    if (includeMap.some((b) => b === false)) {
      this.logger.warn(`Couldn't find all of the containers specified in [${targetContainers.join(',')}], aborting agent injection`)
      return '[]'
    }
    if (!spec.volumes) {
      spec.volumes = []
    }
    // create a volume to fetch the agent jar from
    spec.volumes.push({
      name: 'jacoco-agent',
      persistentVolumeClaim: {
        claimName: this.agentPvcName,
        readOnly: true
      }
    })
    // create volume to store coverage information in
    spec.volumes.push({
      name: 'jacoco-coverage',
      persistentVolumeClaim: {
        claimName: this.coveragePvcName,
        readOnly: false
      }
    })
    // change all the containers to mount in the agent and the coverage
    // add JAVA_TOOL_OPTIONS env var
    spec.containers.filter(c => targetContainers.some((n) => n === c.name)).forEach((c) => {
      this.logger.info(`Container ${JSON.stringify(c)}`)
      if (!c.volumeMounts) c.volumeMounts = []
      c.volumeMounts.push({
        name: 'jacoco-coverage',
        mountPath: '/mnt/jacoco/coverage'
      })
      c.volumeMounts.push({
        name: 'jacoco-agent',
        mountPath: '/mnt/jacoco/agent'
      })
      if (!c.env) c.env = []

      const destfile = `/mnt/jacoco/coverage/${podName}-${c.name}/jacoco.exec`

      c.env.push({
        name: 'JACOCO_FOLDER_PATH',
        value: destfile
      })

      let agentConfig = `-javaagent:/mnt/jacoco/agent/${agentVersion}/jacoco.jar`
      if (enableTcpServer) {
        agentConfig += `=output=tcpserver,address=${tcpServerAddress},port=${tcpServerPort}`
      } else {
        agentConfig += `=destfile=${destfile}`
      }

      if (!c.env.some((e) => e.name === 'JAVA_TOOL_OPTIONS')) {
        c.env.push({
          name: 'JAVA_TOOL_OPTIONS',
          value: agentConfig
        })
      } else {
        c.env.filter((e) => e.name === 'JAVA_TOOL_OPTIONS').forEach((e) => {
          e.value += agentConfig
        })
      }
    })
    return Promise.resolve(JSON.stringify(jsonpatch.generate(observer)))
  }
}

function randomString (length: number) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let result = ''
  for (let i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}
