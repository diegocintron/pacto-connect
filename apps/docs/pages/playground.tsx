import type { NextPage } from 'next'
import Head from 'next/head'
import dynamic from 'next/dynamic'

// Load playground client-side only — it mounts browser-only custom elements
const Playground = dynamic(
  () => import('../components/Playground').then((m) => ({ default: m.Playground })),
  { ssr: false, loading: () => <div style={{ padding: '2rem', color: '#6b7280' }}>Loading playground…</div> },
)

const PlaygroundPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Playground – Pacto Connect</title>
        <meta
          name="description"
          content="Configure the Pacto Connect checkout widget live and copy the generated integration snippet."
        />
      </Head>
      <Playground />
    </>
  )
}

export default PlaygroundPage
