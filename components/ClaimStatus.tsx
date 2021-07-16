import { useTranslation } from 'next-i18next'

import { NextSteps } from './NextSteps'
import { TextLine } from './TextLine'
import { TransLine } from './TransLine'
import { ClaimStatusContent } from '../types/common'

export interface ClaimStatusProps extends ClaimStatusContent {
  loading: boolean
}

export const ClaimStatus: React.FC<ClaimStatusProps> = ({
  loading = false,
  heading,
  summary,
  yourNextSteps,
  eddNextSteps,
}) => {
  const { t } = useTranslation(['common', 'claim-status'])

  return (
    <div className="claim-status">
      <h2>{t('claim-status.title')}</h2>
      <div className="pending-status">
        <TextLine loading={loading} text={t(heading)} />
      </div>
      <div className="summary">
        <TransLine i18nKey={summary.i18nKey} links={summary.links} />
      </div>
      <div className="status-box">
        <div className="topbar">
          <h3 className="next-steps">{t('claim-status.your-next-steps')}</h3>
        </div>
        <div className="explanation">
          <NextSteps loading={loading} nextSteps={yourNextSteps} />
        </div>
      </div>
      <div className="status-box">
        <div className="topbar">
          <h3 className="next-steps">{t('claim-status.edd-next-steps')}</h3>
        </div>
        <div className="explanation">
          <NextSteps loading={loading} nextSteps={eddNextSteps} />
        </div>
      </div>
    </div>
  )
}
