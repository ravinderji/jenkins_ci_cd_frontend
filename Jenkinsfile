/*
 ╔══════════════════════════════════════════════════════════════════════════════╗
 ║  FRONTEND APP PIPELINE  —  frontend-repo/Jenkinsfile                       ║
 ║                                                                              ║
 ║  Stages: Checkout → Read Infra State → NPM Install → NPM Build →            ║
 ║          Docker Build → Docker Push → Ansible Deploy → Smoke Test           ║
 ║                                                                              ║
 ║  Does NOT run Terraform. Infrastructure is managed separately by            ║
 ║  cicd-infra/Jenkinsfile.infra. EC2 IPs are read from:                       ║
 ║    /var/lib/jenkins/tf-state/frontend_ip.txt                                ║
 ║    /var/lib/jenkins/tf-state/backend_ip.txt  (baked into Docker image)      ║
 ║                                                                              ║
 ║  Pre-condition: infra-pipeline AND backend-app-pipeline must have           ║
 ║    run successfully before this pipeline is triggered.                       ║
 ║                                                                              ║
 ║  Required Jenkins credentials:                                               ║
 ║    dockerhub-credentials   Username+Password   DockerHub user + token       ║
 ╚══════════════════════════════════════════════════════════════════════════════╝
 */

pipeline {
    agent any

    environment {
        DOCKERHUB_CREDS           = credentials("dockerhub-credentials")
        IMAGE_NAME                = "${DOCKERHUB_CREDS_USR}/cicd-frontend"
        IMAGE_TAG                 = "${env.BUILD_NUMBER}"
        ANSIBLE_DIR               = "ansible"
        DEPLOY_KEY                = "/var/lib/jenkins/.ssh/deploy-key.pem"
        TF_STATE_DIR              = "/var/lib/jenkins/tf-state"
        ANSIBLE_HOST_KEY_CHECKING = "False"
        ANSIBLE_FORCE_COLOR       = "1"
    }

    stages {

        stage("Stage 1 - Checkout") {
            steps {
                echo "========================================"
                echo " Stage 1 — Checkout"
                echo "========================================"
                checkout scm
                script {
                    env.GIT_SHORT = sh(script: "git rev-parse --short HEAD",
                                       returnStdout: true).trim()
                }
                echo "Branch: ${env.GIT_BRANCH}  Commit: ${env.GIT_SHORT}  Build: #${env.BUILD_NUMBER}"
            }
        }

        // Read BOTH IPs early — backend IP is baked into the Docker image at build time
        stage("Stage 2 - Read Infrastructure State") {
            steps {
                echo "========================================"
                echo " Stage 2 — Read EC2 IPs (no Terraform)"
                echo "========================================"
                script {
                    def frontendIpFile = "${TF_STATE_DIR}/frontend_ip.txt"
                    def backendIpFile  = "${TF_STATE_DIR}/backend_ip.txt"
                    sh """
                        test -f ${frontendIpFile} || {
                            echo "ERROR: ${frontendIpFile} not found. Run infra-pipeline first."
                            exit 1
                        }
                        test -f ${backendIpFile} || {
                            echo "ERROR: ${backendIpFile} not found. Run infra-pipeline and backend-app-pipeline first."
                            exit 1
                        }
                    """
                    env.FRONTEND_IP = sh(script: "cat ${frontendIpFile}", returnStdout: true).trim()
                    env.BACKEND_IP  = sh(script: "cat ${backendIpFile}",  returnStdout: true).trim()
                }
                echo "Target Frontend EC2 : ${env.FRONTEND_IP}"
                echo "Backend API         : http://${env.BACKEND_IP}:8080/api"
            }
        }

        stage("Stage 3 - NPM Install") {
            steps {
                echo "========================================"
                echo " Stage 3 — NPM Install"
                echo "========================================"
                sh "node --version && npm --version"
                sh "npm ci --silent"
            }
        }

        // Backend IP is baked into the React bundle at build time via VITE env var
        stage("Stage 4 - NPM Build") {
            steps {
                echo "========================================"
                echo " Stage 4 — NPM Build"
                echo " VITE_BACKEND_URL=http://${env.BACKEND_IP}:8080"
                echo "========================================"
                sh """
                    VITE_BACKEND_URL=http://${env.BACKEND_IP}:8080 \
                    VITE_BUILD_NUMBER=${env.BUILD_NUMBER} \
                    npm run build
                """
                sh "ls -lh dist/"
                archiveArtifacts artifacts: "dist/**", fingerprint: true
            }
            post { failure { error("NPM build FAILED — pipeline aborted") } }
        }

        stage("Stage 5 - Docker Build") {
            steps {
                echo "========================================"
                echo " Stage 5 — Docker Build: ${IMAGE_NAME}:${IMAGE_TAG}"
                echo "========================================"
                sh """
                    docker build \
                        --build-arg VITE_BACKEND_URL=http://${env.BACKEND_IP}:8080 \
                        --build-arg VITE_BUILD_NUMBER=${env.BUILD_NUMBER} \
                        -t ${IMAGE_NAME}:${IMAGE_TAG} \
                        -t ${IMAGE_NAME}:latest \
                        .
                """
                sh "docker images ${IMAGE_NAME}"
            }
        }

        stage("Stage 6 - Docker Push") {
            steps {
                echo "========================================"
                echo " Stage 6 — Docker Push to DockerHub"
                echo "========================================"
                sh "echo ${DOCKERHUB_CREDS_PSW} | docker login -u ${DOCKERHUB_CREDS_USR} --password-stdin"
                sh "docker push ${IMAGE_NAME}:${IMAGE_TAG}"
                sh "docker push ${IMAGE_NAME}:latest"
                echo "Pushed ${IMAGE_NAME}:${IMAGE_TAG} and ${IMAGE_NAME}:latest"
            }
            post {
                always  { sh "docker logout || true" }
                failure { error("DockerHub push FAILED — pipeline aborted") }
            }
        }

        stage("Stage 7 - Ansible Deploy") {
            steps {
                echo "========================================"
                echo " Stage 7 — Ansible Deploy"
                echo " Target : ${env.FRONTEND_IP}"
                echo " Image  : ${IMAGE_NAME}:${IMAGE_TAG}"
                echo "========================================"
                dir("${ANSIBLE_DIR}") {

                    // Write dynamic inventory with the live EC2 IP
                    sh """
                        cat > inventory/hosts.ini <<EOF
# Generated by Jenkins frontend-app-pipeline — Build #${env.BUILD_NUMBER}
[frontend]
frontend-server  ansible_host=${env.FRONTEND_IP}  ansible_user=ubuntu  ansible_ssh_private_key_file=${DEPLOY_KEY}

[all:vars]
ansible_ssh_common_args='-o StrictHostKeyChecking=no -o ConnectTimeout=30'
EOF
                    """

                    // Wait for SSH to become ready (max 20 × 15s = 5 min)
                    sh """
                        echo "Waiting for frontend EC2 SSH..."
                        for i in \$(seq 1 20); do
                            if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
                                   -i ${DEPLOY_KEY} ubuntu@${env.FRONTEND_IP} \
                                   "echo SSH_OK" 2>/dev/null | grep -q SSH_OK; then
                                echo "SSH ready after \$i attempt(s)"
                                break
                            fi
                            echo "Attempt \$i/20 — not ready, retrying in 15s..."
                            sleep 15
                        done
                    """

                    sh """
                        ansible-playbook playbooks/deploy-frontend.yml \
                            -i inventory/hosts.ini \
                            --private-key ${DEPLOY_KEY} \
                            -e "dockerhub_username=${DOCKERHUB_CREDS_USR}" \
                            -e "frontend_image_tag=${IMAGE_TAG}" \
                            -v
                    """
                }
            }
        }

        stage("Stage 8 - Smoke Test") {
            steps {
                echo "========================================"
                echo " Stage 8 — Smoke Test"
                echo "========================================"
                script {
                    def httpCode = sh(
                        script: """
                            curl -so /dev/null -w '%{http_code}' \
                                 --retry 6 --retry-delay 10 --retry-connrefused \
                                 http://${env.FRONTEND_IP}
                        """,
                        returnStdout: true
                    ).trim()
                    echo "HTTP response: ${httpCode}"
                    if (httpCode != "200") {
                        error("Smoke test FAILED — expected 200, got ${httpCode}")
                    }
                    echo "SMOKE TEST PASSED"
                    echo "App URL : http://${env.FRONTEND_IP}"
                    echo "Backend : http://${env.BACKEND_IP}:8080/api"
                    echo "Image   : ${IMAGE_NAME}:${IMAGE_TAG}"
                }
            }
        }
    }

    post {
        always {
            sh "docker rmi ${IMAGE_NAME}:${IMAGE_TAG} || true"
            sh "docker rmi ${IMAGE_NAME}:latest        || true"
        }
        success { echo "FRONTEND PIPELINE SUCCEEDED — Build #${env.BUILD_NUMBER}" }
        failure { echo "FRONTEND PIPELINE FAILED — Build #${env.BUILD_NUMBER}" }
    }
}
