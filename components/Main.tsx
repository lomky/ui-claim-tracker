import Container from 'react-bootstrap/Container'

import { Title } from './Title'
import { Breadcrumbs } from './Breadcrumbs'
import { ClaimCard } from './ClaimCard'
import { TimeoutModal } from './TimeoutModal'

export interface MainProps {
  timedOut?: boolean
}

export const Main: React.FC<MainProps> = ({ timedOut = false }) => {
  return (
    <main className="main">
      <Container className="main-content">
        <Breadcrumbs />
        <Title />
        <ClaimCard />
      </Container>
      <TimeoutModal action="startOrUpdate" timedOut={timedOut} />
    </main>
  )
}
