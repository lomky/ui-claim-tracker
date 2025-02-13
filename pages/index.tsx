import Head from 'next/head'
import Container from 'react-bootstrap/Container'
import { ReactElement } from 'react'
import { useTranslation } from 'next-i18next'
import { serverSideTranslations } from 'next-i18next/serverSideTranslations'
import { GetServerSideProps } from 'next'
import { Logger as pinoLogger } from 'pino'
import { req as reqSerializer } from 'pino-std-serializers'
import { v4 as uuidv4 } from 'uuid'

import Error from './_error'
import { Header } from '../components/Header'
import { Title } from '../components/Title'
import { ClaimSection } from '../components/ClaimSection'
import { TimeoutModal } from '../components/TimeoutModal'
import { Maintenance } from '../components/Maintenance'
import { Footer } from '../components/Footer'

import { ScenarioContent, UrlPrefixes } from '../types/common'
import { asyncContext } from '../utils/asyncContext'
import getScenarioContent from '../utils/getScenarioContent'
import { Logger } from '../utils/logger'
import queryApiGateway, { getUniqueNumber } from '../utils/queryApiGateway'

export interface HomeProps {
  scenarioContent: ScenarioContent
  timedOut?: boolean
  errorCode?: number | null
  userArrivedFromUioMobile?: boolean
  assetPrefix: string
  urlPrefixes: UrlPrefixes
  enableGoogleAnalytics: string
  enableMaintenancePage: string
}

export default function Home({
  scenarioContent,
  timedOut = false,
  errorCode = null,
  userArrivedFromUioMobile = false,
  assetPrefix,
  urlPrefixes,
  enableGoogleAnalytics,
  enableMaintenancePage,
}: HomeProps): ReactElement {
  const { t } = useTranslation('common')

  // We need to route our static content through /claimstatus to work properly through EDD
  const favicon = assetPrefix + '/favicon.ico'

  // Get scenario name to display in Google Analytics.
  // Default to "None" if no scenario is passed through. This can happen in error cases.
  const scenarioDimension = scenarioContent?.scenarioName ?? 'None'

  // - Once CSP is enabled, if you change the GA script code, you need to update the hash in csp.js to allow
  //   this script to run. Chrome dev tools will have an error with the correct hash value to use.
  //   https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src#Unsafe_inline_script
  // - Send custom dimensions to EDD google analytics instance to capture data about scenarios.
  //   Dimension 2 has been configured in the GA UI for CST Scenarios.
  //   https://developers.google.com/analytics/devguides/collection/gtagjs/custom-dims-mets#send-custom-dimensions
  const gaScript = `
        window.dataLayer = window.dataLayer || []
        function gtag(){dataLayer.push(arguments)}
        gtag('js', new Date())
        // For details see: https://support.google.com/analytics/answer/9310895?hl=en
        // https://developers.google.com/analytics/devguides/collection/gtagjs/ip-anonymization
        gtag('config', 'UA-3419582-2', { 'anonymize_ip': true }) // www.ca.gov
        gtag('config', 'UA-3419582-31', { 'anonymize_ip': true, 'custom_map': {'dimension2': 'scenario'} }) // edd.ca.gov
        gtag('event', 'CST Scenario', {
          "scenario": "${scenarioDimension}",
          "event_category": "Claim Status Tracker",
          "event_label": "${scenarioDimension}",
          "non_interaction": true
        })`

  const googleAnalytics = (
    <>
      {/* Global site tag (gtag.js) - Google Analytics */}
      <script async src="https://www.googletagmanager.com/gtag/js?id=UA-3419582-2" />
      <script
        dangerouslySetInnerHTML={{
          __html: gaScript,
        }}
      />
    </>
  )

  // If any errorCode is provided, render the error page.
  let mainContent: JSX.Element
  if (enableMaintenancePage) {
    mainContent = <Maintenance />
  } else if (errorCode) {
    mainContent = <Error userArrivedFromUioMobile />
  } else {
    mainContent = (
      <>
        <Title />
        <ClaimSection
          userArrivedFromUioMobile={userArrivedFromUioMobile}
          statusContent={scenarioContent.statusContent}
          detailsContent={scenarioContent.detailsContent}
        />
      </>
    )
  }

  // Otherwise, render normally.
  return (
    <Container fluid className="index">
      <Head>
        <title>{t('title')}</title>
        <link rel="icon" href={favicon} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link
          href="https://fonts.googleapis.com/css2?family=Source+Sans+Pro:ital,wght@0,400;0,700;1,400;1,700&display=swap"
          rel="stylesheet"
        />
        {enableGoogleAnalytics === 'enabled' && googleAnalytics}
      </Head>
      <Header userArrivedFromUioMobile={userArrivedFromUioMobile} urlPrefixes={urlPrefixes} assetPrefix={assetPrefix} />
      <main className="main">
        <Container className="main-content">{mainContent}</Container>
      </main>
      <TimeoutModal userArrivedFromUioMobile={userArrivedFromUioMobile} timedOut={timedOut} urlPrefixes={urlPrefixes} />
      <Footer />
    </Container>
  )
}

export const getServerSideProps: GetServerSideProps = async ({ req, res, locale, query }) => {
  // Note whether the user came from the main UIO website or UIO Mobile, and match
  // that in our links back out to UIO.
  const userArrivedFromUioMobile = query?.from === 'uiom'
  const assetPrefix =
    process.env.ASSET_PREFIX === 'undefined' || process.env.ASSET_PREFIX === undefined
      ? '/claimstatus'
      : process.env.ASSET_PREFIX

  // Environment-specific links to UIO, UIO Mobile, and BPO, used by EDD testing
  // Note: it's not possible to use the NEXT_PUBLIC_ prefix to expose these env vars to the browser
  // because they're set at build time, and Azure doesn't inject env vars ("App Settings") until runtime
  const URL_PREFIXES = {
    urlPrefixUioDesktop: process.env.URL_PREFIX_UIO_DESKTOP ?? '',
    urlPrefixUioMobile: process.env.URL_PREFIX_UIO_MOBILE ?? '',
    urlPrefixBpo: process.env.URL_PREFIX_BPO ?? '',
  }

  // Set to 'enabled' to include Google Analytics code
  const ENABLE_GOOGLE_ANALYTICS = process.env.ENABLE_GOOGLE_ANALYTICS ?? ''

  // Set to 'enabled' to display down-for-maintenance page
  const ENABLE_MAINTENANCE_PAGE = process.env.ENABLE_MAINTENANCE_PAGE ?? ''

  // Other vars.
  let errorCode: number | null = null
  let scenarioContent: ScenarioContent | null = null
  const logger: Logger = Logger.getInstance()
  let childLogger: pinoLogger | null = null
  const requestId = uuidv4()

  // Initialize logging.
  try {
    childLogger = await logger.initialize(requestId)
  } catch (error) {
    // If we are unable to set up logging, log to console.
    // This is accessible in Azure Monitor AppServiceConsoleLogs.
    console.log(error)
  }

  // Use a separate try block for errors that are loggable to App Insights.
  try {
    logger.log(
      childLogger,
      'info',
      {
        // If you call pino.info(req), pino does some behind the scenes serialization.
        // If you put the req into an object, it doesn't automatically do the serialization,
        // so we explicitly call it here.
        request: reqSerializer(req),
        query: query,
      },
      'Request',
    )

    // If there is no unique number in the header, AND it is the Front Door health probe,
    // then display a 500 but don't log an error.
    // If there is no unique number in the header, BUT it is not the health probe,
    // then display a 500 AND log an error.
    const uniqueNumber = getUniqueNumber(req)

    if (!uniqueNumber) {
      if (req.headers['user-agent'] !== 'Edge Health Probe') {
        logger.log(childLogger, 'error', {}, 'Missing unique number')
      }
      errorCode = 500
    }
    // Only query the API gateway if there is a unique number in the header.
    else {
      await asyncContext.run(childLogger, async () => {
        // Make the API request and return the data.
        const claimData = await queryApiGateway(req, uniqueNumber)
        logger.log(childLogger, 'info', claimData, 'ClaimData')

        // Run business logic to get content for the current scenario.
        scenarioContent = getScenarioContent(claimData)
        logger.log(childLogger, 'info', scenarioContent, 'ScenarioContent')
      })
    }
  } catch (error) {
    // If an error occurs, log it and show 500.
    logger.log(childLogger, 'error', error, 'Application error')
    errorCode = 500
  }

  // If there is an errorCode, set the response statusCode to match.
  if (errorCode) {
    res.statusCode = errorCode
  }

  // Return Props.
  return {
    props: {
      scenarioContent: scenarioContent,
      errorCode: errorCode,
      userArrivedFromUioMobile: userArrivedFromUioMobile,
      assetPrefix: assetPrefix,
      urlPrefixes: URL_PREFIXES,
      enableGoogleAnalytics: ENABLE_GOOGLE_ANALYTICS,
      enableMaintenancePage: ENABLE_MAINTENANCE_PAGE,
      ...(await serverSideTranslations(locale || 'en', ['common', 'claim-details', 'claim-status'])),
    },
  }
}
